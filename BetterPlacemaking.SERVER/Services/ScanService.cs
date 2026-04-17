using System;
using Google.Cloud.Firestore;
using System.Linq;
using System.Text.Json;
using BetterPlacemaking.Models;
using Google.Cloud.Firestore;

namespace BetterPlacemaking.Services
{
    public class ScanService(FirestoreDb db, DeviceService deviceService)
    {
        private readonly FirestoreDb _db = db;
        private readonly DeviceService _deviceService = deviceService;

        /// <summary>
        /// Oldest pending scan for the device, or null if none.
        /// </summary>
        public string? GetNextPendingScanId(string projectId, string deviceId)
        {
            var snap = _db
                .Collection("projects")
                .Document(projectId)
                .Collection("devices")
                .Document(deviceId)
                .Collection("scans")
                .GetSnapshotAsync()
                .Result;

            static Timestamp CreatedAtOrEpoch(DocumentSnapshot d)
            {
                if (d.ContainsField("CreatedAt"))
                    return d.GetValue<Timestamp>("CreatedAt");
                return Timestamp.FromDateTime(DateTime.SpecifyKind(DateTime.UnixEpoch, DateTimeKind.Utc));
            }

            return snap.Documents
                .Where(d => d.Exists
                    && d.ContainsField("Status")
                    && string.Equals(d.GetValue<string>("Status"), "pending", StringComparison.OrdinalIgnoreCase))
                .OrderBy(CreatedAtOrEpoch)
                .Select(d => d.Id)
                .FirstOrDefault();
        }

        public object CreateScan(string projectId, string deviceId, ScanSettingsRequest settings, string? initiatedByUserId = null)
        {
            var collection = _db
                .Collection("projects")
                .Document(projectId)
                .Collection("devices")
                .Document(deviceId)
                .Collection("scans");

            var scan = new Dictionary<string, object?>
            {
                { "Status", "pending" },
                { "CreatedAt", Timestamp.GetCurrentTimestamp() },
                { "StartedAt", null },
                { "FinishedAt", null },
                { "ObjUrl", null },
                { "Error", null },
                { "InitiatedByUserId", initiatedByUserId },

                { "scan_resolution", settings.scan_resolution },
                { "protocol_mode", settings.protocol_mode },
                { "orientation_mode", settings.orientation_mode },
                { "output_mode", settings.output_mode },
                { "split_mode", settings.split_mode },
                { "filter_enabled", settings.filter_enabled },
                { "capture_strategy", settings.capture_strategy },
                { "min_revolutions_per_slice", settings.min_revolutions_per_slice },
                { "force_recalibration", settings.force_recalibration },
                { "ScanSettingsJson", JsonSerializer.Serialize(settings) }

            };

            var docRef = collection.Document();
            docRef.SetAsync(scan).Wait();

            // Wake the Jetson scan orchestrator. Writes only Config.LidarScan.BeginScanning on
            // the root devices/{deviceId} doc (the one the heartbeat reads) and invalidates the
            // Device cache. Heartbeat then delivers the flag once and one-shot clears it.
            _deviceService.StartLidarScan(deviceId, settings);

            return new
            {
                Id = docRef.Id,
                Status = "pending"
            };
        }

        public (bool Exists, string? ScanId, string? Status) HasPendingOrRunningScan(string projectId, string deviceId)
        {
            if (string.IsNullOrWhiteSpace(projectId) || string.IsNullOrWhiteSpace(deviceId))
                return (false, null, null);

            var scans = GetScans(projectId, deviceId);
            foreach (var row in scans)
            {
                var status = GetScanStringField(row, "Status");
                if (string.Equals(status, "pending", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(status, "running", StringComparison.OrdinalIgnoreCase))
                {
                    var scanId = GetScanStringField(row, "Id");
                    return (true, scanId, status);
                }
            }

            return (false, null, null);
        }

        public List<Dictionary<string, object>> GetScans(string projectId, string deviceId)
        {
            var response = _db
                .Collection("projects")
                .Document(projectId)
                .Collection("devices")
                .Document(deviceId)
                .Collection("scans")
                .GetSnapshotAsync()
                .Result
                .Documents
                .Select(doc =>
                {
                    var data = doc.ToDictionary();
                    data["Id"] = doc.Id;
                    return data;
                })
                .ToList();

            return response;
        }

        public Dictionary<string, object>? GetScan(string projectId, string deviceId, string scanId)
        {
            var snap = _db
                .Collection("projects")
                .Document(projectId)
                .Collection("devices")
                .Document(deviceId)
                .Collection("scans")
                .Document(scanId)
                .GetSnapshotAsync()
                .Result;

            if (!snap.Exists)
                return null;

            var response = snap.ToDictionary();
            response["Id"] = snap.Id;
            return response;
        }

        public bool UpdateScanStatus(string projectId, string deviceId, string scanId, string? status, string? objUrl, string? error)
        {
            var docRef = _db
                .Collection("projects")
                .Document(projectId)
                .Collection("devices")
                .Document(deviceId)
                .Collection("scans")
                .Document(scanId);

            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return false;

            var updates = new Dictionary<string, object>();

            if (!string.IsNullOrWhiteSpace(status))
                updates["Status"] = status;

            if (!string.IsNullOrWhiteSpace(objUrl))
                updates["ObjUrl"] = objUrl;

            if (!string.IsNullOrWhiteSpace(error))
                updates["Error"] = error;

            if (!string.IsNullOrWhiteSpace(status)
                && string.Equals(status, "running", StringComparison.OrdinalIgnoreCase))
                updates["StartedAt"] = Timestamp.GetCurrentTimestamp();

            if (!string.IsNullOrWhiteSpace(status)
                && (string.Equals(status, "complete", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(status, "error", StringComparison.OrdinalIgnoreCase)))
                updates["FinishedAt"] = Timestamp.GetCurrentTimestamp();

            if (updates.Count == 0)
                return true;

            docRef.UpdateAsync(updates).Wait();
            return true;
        }

        public bool DeleteScan(string projectId, string deviceId, string scanId)
        {
            var docRef = _db
                .Collection("projects")
                .Document(projectId)
                .Collection("devices")
                .Document(deviceId)
                .Collection("scans")
                .Document(scanId);

            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return false;

            docRef.DeleteAsync().Wait();
            return true;
        }

        /// <summary>
        /// Latest <c>Status=complete</c> scan for this project across the given device ids (by <see cref="GetScans"/>).
        /// </summary>
        public (string DeviceId, Dictionary<string, object> Scan)? GetLatestCompleteScanForProject(
            string projectId,
            IEnumerable<string> deviceIds)
        {
            if (string.IsNullOrWhiteSpace(projectId))
                return null;

            (string DeviceId, Dictionary<string, object> Scan, DateTime SortUtc)? best = null;
            foreach (var deviceId in deviceIds)
            {
                if (string.IsNullOrWhiteSpace(deviceId))
                    continue;

                foreach (var scan in GetScans(projectId, deviceId))
                {
                    var st = GetScanStringField(scan, "Status");
                    if (!string.Equals(st, "complete", StringComparison.OrdinalIgnoreCase))
                        continue;

                    var sortUtc = GetScanFinishedOrCreatedUtc(scan);
                    if (best == null || sortUtc > best.Value.SortUtc)
                        best = (deviceId, scan, sortUtc);
                }
            }

            if (best == null)
                return null;

            return (best.Value.DeviceId, best.Value.Scan);
        }

        private static string? GetScanStringField(Dictionary<string, object> row, string key)
        {
            foreach (var k in new[] { key, char.ToLowerInvariant(key[0]) + key[1..] })
            {
                if (row.TryGetValue(k, out var v) && v != null)
                {
                    if (v is string s)
                        return s;
                    return v.ToString();
                }
            }

            return null;
        }

        private static DateTime GetScanFinishedOrCreatedUtc(Dictionary<string, object> row)
        {
            if (TryGetTimestampUtc(row, "FinishedAt", out var t))
                return t;
            if (TryGetTimestampUtc(row, "CreatedAt", out t))
                return t;

            return DateTime.MinValue;
        }

        private static bool TryGetTimestampUtc(Dictionary<string, object> row, string key, out DateTime utc)
        {
            utc = default;
            foreach (var k in new[] { key, char.ToLowerInvariant(key[0]) + key[1..] })
            {
                if (!row.TryGetValue(k, out var v) || v == null)
                    continue;

                if (v is Timestamp ts)
                {
                    utc = ts.ToDateTime();
                    return true;
                }

                if (v is DateTime dt)
                {
                    utc = dt.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(dt, DateTimeKind.Utc) : dt.ToUniversalTime();
                    return true;
                }
            }

            return false;
        }
    }
}
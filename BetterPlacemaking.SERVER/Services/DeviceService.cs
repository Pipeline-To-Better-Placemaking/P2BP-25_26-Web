using System.Security.Cryptography;
using System.Text;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Mvc;
using BetterPlacemaking.Models;
using BetterPlacemaking.Models.JetsonDTOs;

namespace BetterPlacemaking.Services
{
    public class DeviceService(FirestoreDb db) : ControllerBase
    {
        private readonly FirestoreDb _db = db;
        private const string collectionName = "devices";

        public List<Device> GetDevices()
        {
            var response = _db.Collection(collectionName).GetSnapshotAsync().Result.Documents
                .Select(doc => doc.ConvertTo<Device>())
                .ToList();

            return response;
        }

        public Device? GetDevice(string id)
        {
            var device = _db.Collection(collectionName).Document(id).GetSnapshotAsync().Result
                .ConvertTo<Device>();

            return device;
        }

        public Device? AddDevice(Device device)
        {
            var collection = _db.Collection(collectionName);

            if (!string.IsNullOrEmpty(device?.Id))
            {
                var docRef = collection.Document(device.Id);
                docRef.SetAsync(device).Wait();
                var added = docRef.GetSnapshotAsync().Result
                    .ConvertTo<Device>();
                return added;
            }

            var newDocRef = collection.AddAsync(device).Result;
            var created = newDocRef.GetSnapshotAsync().Result
                .ConvertTo<Device>();
            return created;
        }

        public Device? UpdateDevice(string id, Device device)
        {
            var docRef = _db.Collection(collectionName).Document(id);

            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return null;

            var existing = snap.ConvertTo<Device>();
			device.ApiKeyHash = existing.ApiKeyHash;
			device.HealthReport = existing.HealthReport;
            docRef.SetAsync(device).Wait();
            var updated = docRef.GetSnapshotAsync().Result
                .ConvertTo<Device>();
            return updated;
        }

        public Device? GetDeviceByApiKey(string apiKey)
        {
            var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(apiKey));
            var hash = Convert.ToBase64String(hashBytes);

            var query = _db.Collection(collectionName)
                .WhereEqualTo(nameof(Device.ApiKeyHash), hash)
                .Limit(1);

            var snapshot = query.GetSnapshotAsync().Result;
            var doc = snapshot.Documents.FirstOrDefault();
            return doc?.ConvertTo<Device>();
        }

        public string? GenerateAndUpdateApiKey(string id)
        {
            var docRef = _db.Collection(collectionName).Document(id);
            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return null;

            var device = snap.ConvertTo<Device>();
            if (device == null)
                return null;

            var newKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
            var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(newKey));
            var hash = Convert.ToBase64String(hashBytes);
            device.ApiKeyHash = hash;
            docRef.SetAsync(device).Wait();
            return newKey;
        }

        public bool DeleteDevice(string id)
        {
            var docRef = _db.Collection(collectionName).Document(id);
            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return false;

            docRef.DeleteAsync().Wait();
            return true;
        }

        public bool UpdateDeviceHealthReport(string deviceId, HealthReport healthReport)
        {
            var docRef = _db.Collection(collectionName).Document(deviceId);
            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return false;

            var device = snap.ConvertTo<Device>();
            if (device == null)
                return false;

            device.Config ??= new Config();

            var existingTracking = device.Config.TrackingCameras ?? [];
            var existingByNorm = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            foreach (var kvp in existingTracking)
            {
                var norm = NormalizeMac(kvp.Key);
                if (string.IsNullOrWhiteSpace(norm))
                    continue;

                if (!existingByNorm.ContainsKey(norm))
                    existingByNorm[norm] = kvp.Value;
            }

            var reportMacs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (healthReport?.Cameras != null)
            {
                foreach (var kvp in healthReport.Cameras)
                {
                    var mac = NormalizeMac(kvp.Value?.Mac);
                    if (string.IsNullOrWhiteSpace(mac))
                        mac = NormalizeMac(kvp.Key);

                    if (!string.IsNullOrWhiteSpace(mac))
                        reportMacs.Add(mac);
                }
            }

            var mergedTracking = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            foreach (var mac in reportMacs)
            {
                if (existingByNorm.TryGetValue(mac, out var existingValue))
                    mergedTracking[mac] = existingValue;
                else
                    mergedTracking[mac] = false;
            }

            device.Config.TrackingCameras = mergedTracking;
            device.HealthReport = healthReport;

            docRef.UpdateAsync(new Dictionary<string, object>
            {
                { nameof(Device.HealthReport), device.HealthReport! },
                { nameof(Device.Config), device.Config! }
            }).Wait();

            return true;
        }

        private static string NormalizeMac(string? mac)
        {
            return (mac ?? string.Empty).Trim().ToLowerInvariant();
        }
    }
}
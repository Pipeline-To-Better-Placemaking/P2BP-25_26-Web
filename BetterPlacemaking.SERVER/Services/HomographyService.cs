using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using BetterPlacemaking.Models.Dtos;
using BetterPlacemaking.Models.Homography;
using Google.Cloud.Firestore;
using Microsoft.Extensions.Logging;

namespace BetterPlacemaking.Services
{
    public class HomographyService(FirestoreDb db, ILogger<HomographyService> logger)
    {
        private readonly FirestoreDb _db = db;
        private readonly ILogger<HomographyService> _logger = logger;

        private const string ColLocalHomographies = "local_homographies";
        private const string ColSessions = "aruco_sessions";
        private const string ColSightings = "aruco_sightings";
        private const string ColLockedHomographies = "locked_homographies";

        public LocalHomographyResponseDto SubmitLocalHomography(string deviceId, SubmitLocalHomographyDto dto)
        {
            // Upsert: one document per (deviceId, cameraMac), overwriting previous calibration.
            var docId = $"{deviceId}_{NormalizeMac(dto.CameraMac)}";
            var docRef = _db.Collection(ColLocalHomographies).Document(docId);

            var record = new LocalHomography
            {
                DeviceId = deviceId,
                CameraMac = NormalizeMac(dto.CameraMac),
                Matrix = dto.Matrix,
                FrameSize = dto.FrameSize,
                Inliers = dto.Inliers,
                RmseBoard = dto.RmseBoard,
                CornersUsed = dto.CornersUsed,
                MarkersDetected = dto.MarkersDetected,
                ArucoDict = dto.ArucoDict,
                SquaresX = dto.SquaresX,
                SquaresY = dto.SquaresY,
                SquareLength = dto.SquareLength,
                MarkerLength = dto.MarkerLength,
                TimestampUnix = dto.TimestampUnix,
                SnapshotPath = dto.SnapshotPath,
                CameraMatrix = dto.CameraMatrix,
                DistortionCoefficients = dto.DistortionCoefficients,
            };

            docRef.SetAsync(record).Wait();
            _logger.LogInformation("Stored local homography for device={DeviceId} camera={Mac}", deviceId, dto.CameraMac);

            return new LocalHomographyResponseDto(docId, dto.CameraMac);
        }

        public CameraIntrinsicsResponseDto? GetIntrinsics(string deviceId, string mac)
        {
            var docId = $"{deviceId}_{NormalizeMac(mac)}";
            var snap = _db.Collection(ColLocalHomographies).Document(docId).GetSnapshotAsync().Result;
            if (!snap.Exists)
                return null;

            var record = snap.ConvertTo<LocalHomography>();
            if (record?.CameraMatrix == null || record.DistortionCoefficients == null)
                return null;

            return new CameraIntrinsicsResponseDto(
                record.CameraMac ?? mac,
                record.CameraMatrix,
                record.DistortionCoefficients,
                record.TimestampUnix
            );
        }

        public ArucoSightingsResponseDto SubmitArucoSightings(string deviceId, SubmitArucoSightingsDto dto)
        {
            var mac = NormalizeMac(dto.CameraMac);

            ArUcoScanSession session = ResolveOrCreateSession(dto.SessionId, dto.ArucoDict);
            string sessionId = session.Id!;

            // Upsert: one sighting document per camera per session.
            var sightingRef = _db.Collection(ColSightings).Document($"{sessionId}_{mac}");

            var sighting = new ArUcoSighting
            {
                SessionId = sessionId,
                DeviceId = deviceId,
                CameraMac = mac,
                ArucoDict = dto.ArucoDict,
                CapturedAt = dto.CapturedAt,
                Markers = dto.Markers.Select(m => new ArUcoMarkerRecord
                {
                    MarkerId = m.MarkerId,
                    CornersPx = m.CornersPx,
                }).ToList(),
                LocalHomographyHash = dto.LocalHomographyHash,
            };

            sightingRef.SetAsync(sighting).Wait();

            var checkedIn = session.CamerasCheckedIn ?? [];
            if (!checkedIn.Contains(mac, StringComparer.OrdinalIgnoreCase))
            {
                checkedIn = [.. checkedIn, mac];
                var sessionRef = _db.Collection(ColSessions).Document(sessionId);
                sessionRef.UpdateAsync(new Dictionary<string, object>
                {
                    { nameof(ArUcoScanSession.CamerasCheckedIn), checkedIn },
                    { nameof(ArUcoScanSession.CamerasTotal), checkedIn.Count },
                }).Wait();
                session.CamerasCheckedIn = checkedIn;
                session.CamerasTotal = checkedIn.Count;
            }

            _logger.LogInformation(
                "Sightings stored for device={DeviceId} camera={Mac} session={SessionId} markers={Count}",
                deviceId, mac, sessionId, dto.Markers.Count);

            return new ArucoSightingsResponseDto(
                SessionId: sessionId,
                Status: session.Status,
                CamerasCheckedIn: session.CamerasCheckedIn ?? [],
                CamerasTotal: session.CamerasTotal
            );
        }

        private ArUcoScanSession ResolveOrCreateSession(string? sessionId, string arucoDict)
        {
            // If the caller provided a sessionId (cameras 2–N of a single scan run), resolve it.
            // When sessionId is null (first camera in a run), always create a fresh session —
            // never auto-join an existing one because markers may have moved since the last scan.
            if (!string.IsNullOrWhiteSpace(sessionId))
            {
                var snap = _db.Collection(ColSessions).Document(sessionId).GetSnapshotAsync().Result;
                if (snap.Exists)
                    return snap.ConvertTo<ArUcoScanSession>();
            }

            var newSession = new ArUcoScanSession
            {
                ArucoDict = arucoDict,
                Status = "collecting",
                CamerasCheckedIn = [],
                CamerasTotal = 0,
                CreatedAt = Timestamp.GetCurrentTimestamp(),
            };
            var newRef = _db.Collection(ColSessions).AddAsync(newSession).Result;
            var created = newRef.GetSnapshotAsync().Result.ConvertTo<ArUcoScanSession>();
            _logger.LogInformation("Created new ArUco scan session {SessionId}", created.Id);
            return created;
        }

        public ComputeLockResponseDto ComputeLock()
        {
            Dictionary<string, string> cameraDevice = [];
            try
            {
                var (computed, devMap) = RunBfsLock();
                cameraDevice = devMap;
                _logger.LogInformation("Compute-lock complete: {N} cameras", computed);
                WriteArucoLockStatus(cameraDevice, "done");
                return new ComputeLockResponseDto("done", computed);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Compute-lock failed");
                WriteArucoLockStatus(cameraDevice, "failed");
                throw;
            }
        }

        private void WriteArucoLockStatus(Dictionary<string, string> cameraDevice, string status)
        {
            var deviceIds = cameraDevice.Values.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;
            foreach (var deviceId in deviceIds)
            {
                try
                {
                    _db.Collection("devices").Document(deviceId).UpdateAsync(new Dictionary<string, object>
                    {
                        { "Config.ArucoLock.Status", status },
                        { "Config.ArucoLock.LastRunUnix", now },
                    }).Wait();
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to write ArucoLock status for device {DeviceId}", deviceId);
                }
            }
        }

        private (int count, Dictionary<string, string> cameraDevice) RunBfsLock()
        {
            // Load all sightings across all sessions.
            var sightingDocs = _db.Collection(ColSightings).GetSnapshotAsync().Result.Documents;

            // cameraMarkersPx[mac]["{sessionId}_{markerId}"] = pixel corners [[x,y]x4]
            // Prefixing with sessionId means marker 1 in session A and marker 1 in session B
            // are treated as independent observations, even if the physical marker moved.
            var cameraMarkersPx = new Dictionary<string, Dictionary<string, List<List<double>>>>(StringComparer.OrdinalIgnoreCase);
            var cameraDevice = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            // First pass: collect device IDs and sighting hashes from all docs.
            var sightingsByCam = new Dictionary<string, ArUcoSighting>(StringComparer.OrdinalIgnoreCase);
            foreach (var doc in sightingDocs)
            {
                var s = doc.ConvertTo<ArUcoSighting>();
                if (s.CameraMac == null || s.SessionId == null) continue;
                var mac = s.CameraMac;
                if (s.DeviceId != null)
                    cameraDevice[mac] = s.DeviceId;
                // Keep the most recent sighting per camera (last write wins, same as Firestore upsert).
                sightingsByCam[mac] = s;
            }

            // Load current local homographies once per camera and compute their hashes.
            // This cache is also reused by StoreLocked to avoid a second Firestore read.
            var localHomographyCache = new Dictionary<string, LocalHomography?>(StringComparer.OrdinalIgnoreCase);
            foreach (var (mac, s) in sightingsByCam)
            {
                if (!cameraDevice.TryGetValue(mac, out var deviceId)) continue;
                var localSnap = _db.Collection(ColLocalHomographies)
                    .Document($"{deviceId}_{mac}").GetSnapshotAsync().Result;
                localHomographyCache[mac] = localSnap.Exists ? localSnap.ConvertTo<LocalHomography>() : null;
            }

            // Filter: discard sightings whose attached homography hash doesn't match the
            // camera's current local homography. This protects compute-lock from stale
            // sightings captured before the camera was moved and re-calibrated.
            foreach (var (mac, s) in sightingsByCam)
            {
                var currentHash = localHomographyCache.TryGetValue(mac, out var lh) && lh?.Matrix != null
                    ? ComputeHomographyHash(lh.Matrix)
                    : null;

                if (s.LocalHomographyHash == null || currentHash == null)
                {
                    _logger.LogWarning(
                        "Skipping sightings for camera {Mac}: missing homography hash (sighting={SightingHash}, current={CurrentHash}). " +
                        "Re-run an ArUco scan after completing ChArUco calibration.",
                        mac, s.LocalHomographyHash ?? "null", currentHash ?? "null");
                    continue;
                }

                if (!string.Equals(s.LocalHomographyHash, currentHash, StringComparison.OrdinalIgnoreCase))
                {
                    _logger.LogWarning(
                        "Skipping stale sightings for camera {Mac}: hash mismatch (sighting={SightingHash}, current={CurrentHash}). " +
                        "Camera was likely moved and re-calibrated since the last ArUco scan.",
                        mac, s.LocalHomographyHash, currentHash);
                    continue;
                }

                if (!cameraMarkersPx.ContainsKey(mac))
                    cameraMarkersPx[mac] = [];
                foreach (var m in s.Markers ?? [])
                {
                    var key = $"{s.SessionId}_{m.MarkerId}";
                    cameraMarkersPx[mac][key] = m.CornersPx ?? [];
                }
            }

            if (cameraMarkersPx.Count == 0)
                throw new InvalidOperationException("No sightings found with a valid homography hash. Run a fresh ArUco scan.");

            // Apply each camera's local homography server-side to convert pixel corners
            // to local world coords. The Jetsons only store raw pixel observations.
            var cameraMarkersLocal = new Dictionary<string, Dictionary<string, List<List<double>>>>(StringComparer.OrdinalIgnoreCase);
            foreach (var (mac, markerPxMap) in cameraMarkersPx)
            {
                if (!localHomographyCache.TryGetValue(mac, out var localH) || localH?.Matrix == null) continue;
                var H = ToMatrix3x3(localH.Matrix);
                var localMap = new Dictionary<string, List<List<double>>>();
                foreach (var (key, pxCorners) in markerPxMap)
                {
                    localMap[key] = pxCorners
                        .Where(c => c.Count >= 2)
                        .Select(c => ApplyHomographyPoint(H, c[0], c[1]))
                        .ToList();
                }
                cameraMarkersLocal[mac] = localMap;
            }

            var cameras = cameraMarkersLocal.Keys.ToList();
            if (cameras.Count == 0)
                throw new InvalidOperationException("No cameras have both sightings and a valid local homography.");

            if (cameras.Count == 1)
                return (StoreLocked(cameras[0], cameraDevice, Identity3x3(), localHomographyCache), cameraDevice);

            // Build similarity transform edges between all camera pairs that share markers.
            var edges = new Dictionary<(string, string), double[,]>();
            for (int i = 0; i < cameras.Count; i++)
            {
                for (int j = i + 1; j < cameras.Count; j++)
                {
                    var ci = cameras[i];
                    var cj = cameras[j];
                    var sharedKeys = cameraMarkersLocal[ci].Keys
                        .Intersect(cameraMarkersLocal[cj].Keys).ToList();
                    if (sharedKeys.Count == 0) continue;

                    var pairsIJ = new List<(double, double, double, double)>();
                    var pairsJI = new List<(double, double, double, double)>();
                    foreach (var key in sharedKeys)
                    {
                        var cornersI = cameraMarkersLocal[ci][key];
                        var cornersJ = cameraMarkersLocal[cj][key];
                        int n = Math.Min(cornersI.Count, cornersJ.Count);
                        for (int k = 0; k < n; k++)
                        {
                            if (cornersI[k].Count < 2 || cornersJ[k].Count < 2) continue;
                            pairsIJ.Add((cornersI[k][0], cornersI[k][1], cornersJ[k][0], cornersJ[k][1]));
                            pairsJI.Add((cornersJ[k][0], cornersJ[k][1], cornersI[k][0], cornersI[k][1]));
                        }
                    }
                    if (pairsIJ.Count < 2) continue;
                    edges[(ci, cj)] = EstimateSimilarity2D(pairsIJ);
                    edges[(cj, ci)] = EstimateSimilarity2D(pairsJI);
                }
            }

            var adjacency = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
            foreach (var (pair, _) in edges)
            {
                var (a, b) = pair;
                if (!adjacency.ContainsKey(a)) adjacency[a] = [];
                if (!adjacency.ContainsKey(b)) adjacency[b] = [];
                if (!adjacency[a].Contains(b)) adjacency[a].Add(b);
                if (!adjacency[b].Contains(a)) adjacency[b].Add(a);
            }

            var root = cameras
                .OrderByDescending(c => adjacency.TryGetValue(c, out var n) ? n.Count : 0)
                .ThenBy(c => c)
                .First();

            var tToGlobal = new Dictionary<string, double[,]>(StringComparer.OrdinalIgnoreCase)
            {
                [root] = Identity3x3()
            };
            var queue = new Queue<string>();
            queue.Enqueue(root);
            while (queue.Count > 0)
            {
                var parent = queue.Dequeue();
                if (!adjacency.TryGetValue(parent, out var neighbors)) continue;
                foreach (var child in neighbors)
                {
                    if (tToGlobal.ContainsKey(child)) continue;
                    if (!edges.TryGetValue((child, parent), out var t)) continue;
                    tToGlobal[child] = MatMul3x3(tToGlobal[parent], t);
                    queue.Enqueue(child);
                }
            }

            foreach (var mac in cameras.Where(c => !tToGlobal.ContainsKey(c)))
                _logger.LogWarning("Camera {Mac} not reachable from root {Root}; skipping.", mac, root);

            int count = 0;
            foreach (var (mac, t) in tToGlobal)
                count += StoreLocked(mac, cameraDevice, t, localHomographyCache);
            return (count, cameraDevice);
        }

        private int StoreLocked(string mac, Dictionary<string, string> cameraDevice, double[,] tToGlobal,
            Dictionary<string, LocalHomography?> localHomographyCache)
        {
            if (!cameraDevice.TryGetValue(mac, out var deviceId))
            {
                _logger.LogWarning("No device ID for camera {Mac}; skipping.", mac);
                return 0;
            }

            if (!localHomographyCache.TryGetValue(mac, out var localH) || localH == null)
            {
                _logger.LogWarning("No local homography for device={DeviceId} camera={Mac}; skipping.", deviceId, mac);
                return 0;
            }

            if (localH.Matrix == null) return 0;

            var hLocked = MatMul3x3(tToGlobal, ToMatrix3x3(localH.Matrix));
            _db.Collection(ColLockedHomographies).Document($"{deviceId}_{mac}").SetAsync(new LockedHomography
            {
                DeviceId = deviceId,
                CameraMac = mac,
                Matrix = FromMatrix3x3(hLocked),
                ComputedAt = Timestamp.GetCurrentTimestamp(),
            }).Wait();
            return 1;
        }

        public SessionStatusResponseDto GetSessionStatus(string sessionId)
        {
            var snap = _db.Collection(ColSessions).Document(sessionId).GetSnapshotAsync().Result;
            if (!snap.Exists)
                throw new KeyNotFoundException($"Session {sessionId} not found.");

            var session = snap.ConvertTo<ArUcoScanSession>();
            return new SessionStatusResponseDto(
                SessionId: sessionId,
                Status: session.Status,
                CamerasCheckedIn: session.CamerasCheckedIn ?? [],
                CamerasTotal: session.CamerasTotal,
                CreatedAt: session.CreatedAt.ToDateTime().ToString("o")
            );
        }

        private static double[,] Identity3x3() => new double[,]
        {
            { 1, 0, 0 },
            { 0, 1, 0 },
            { 0, 0, 1 },
        };

        private static double[,] MatMul3x3(double[,] A, double[,] B)
        {
            var C = new double[3, 3];
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++)
                    for (int k = 0; k < 3; k++)
                        C[i, j] += A[i, k] * B[k, j];
            return C;
        }

        private static List<double> ApplyHomographyPoint(double[,] H, double x, double y)
        {
            double denom = H[2, 0] * x + H[2, 1] * y + H[2, 2];
            if (Math.Abs(denom) < 1e-12) return [0.0, 0.0];
            return [(H[0, 0] * x + H[0, 1] * y + H[0, 2]) / denom,
                    (H[1, 0] * x + H[1, 1] * y + H[1, 2]) / denom];
        }

        private static double[,] EstimateSimilarity2D(List<(double sx, double sy, double dx, double dy)> pairs)
        {
            if (pairs.Count < 2)
                throw new InvalidOperationException("Need at least 2 point pairs for similarity estimation.");

            double srcMx = pairs.Average(p => p.sx);
            double srcMy = pairs.Average(p => p.sy);
            double dstMx = pairs.Average(p => p.dx);
            double dstMy = pairs.Average(p => p.dy);

            double sumA = 0, sumB = 0, sumSq = 0;
            foreach (var (sx, sy, dx, dy) in pairs)
            {
                double scx = sx - srcMx, scy = sy - srcMy;
                double dcx = dx - dstMx, dcy = dy - dstMy;
                sumA += scx * dcx + scy * dcy;
                sumB += scx * dcy - scy * dcx;
                sumSq += scx * scx + scy * scy;
            }

            double a, b;
            if (sumSq < 1e-12) { a = 1; b = 0; }
            else { a = sumA / sumSq; b = sumB / sumSq; }

            double tx = dstMx - (a * srcMx - b * srcMy);
            double ty = dstMy - (b * srcMx + a * srcMy);

            return new double[,]
            {
                { a, -b, tx },
                { b,  a, ty },
                { 0,  0,  1 },
            };
        }

        private static double[,] ToMatrix3x3(List<List<double>> m)
        {
            var result = new double[3, 3];
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++)
                    result[i, j] = m[i][j];
            return result;
        }

        private static List<List<double>> FromMatrix3x3(double[,] m) =>
            Enumerable.Range(0, 3)
                .Select(i => Enumerable.Range(0, 3).Select(j => m[i, j]).ToList())
                .ToList();

        private static string NormalizeMac(string? mac) =>
            (mac ?? string.Empty).Trim().ToLowerInvariant();

        /// <summary>
        /// Computes a short stable hash of a 3×3 homography matrix for staleness detection.
        /// Matches the algorithm in aruco_scanner.py: flatten row-major, round to 4 decimal
        /// places, join with commas, SHA256, take first 16 hex chars lowercase.
        /// </summary>
        private static string ComputeHomographyHash(List<List<double>> matrix)
        {
            var values = matrix.SelectMany(row => row)
                .Select(v => Math.Round(v, 4).ToString("F4", CultureInfo.InvariantCulture));
            var input = string.Join(",", values);
            var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(input));
            return Convert.ToHexString(bytes)[..16].ToLowerInvariant();
        }
    }
}

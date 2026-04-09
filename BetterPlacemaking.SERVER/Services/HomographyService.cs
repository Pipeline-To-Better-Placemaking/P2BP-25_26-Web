using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using BetterPlacemaking.Models;
using BetterPlacemaking.Models.Dtos;
using BetterPlacemaking.Models.Homography;
using Google.Cloud.Firestore;
using Microsoft.Extensions.Logging;
using OpenCvSharp;
using YamlDotNet.Serialization;

namespace BetterPlacemaking.Services
{
    public class HomographyService(FirestoreDb db, CloudStorageService cloudStorage, ILogger<HomographyService> logger)
    {
        private readonly FirestoreDb _db = db;
        private readonly CloudStorageService _cloudStorage = cloudStorage;
        private readonly ILogger<HomographyService> _logger = logger;

        private const string ColLocalHomographies = "local_homographies";
        private const string ColSessions = "aruco_sessions";
        private const string ColSightings = "aruco_sightings";
        private const string ColLockedHomographies = "locked_homographies";
        private const string ColPuzzlePieces = "puzzle_pieces";
        private const string ColGlobalHomographies = "global_homographies";
        private const string ColDevices = "devices";
        private const int PuzzlePieceGenerationVersion = 2;

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
                UsedUndistortedImage = dto.UsedUndistortedImage,
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

        public Task<PuzzleWorkspaceResponseDto> RefreshPuzzlePiecesAsync(string projectId, CancellationToken ct)
        {
            return GetPuzzleWorkspaceAsync(projectId, ct, forcePuzzlePieceRegeneration: true);
        }

        public async Task<PuzzleWorkspaceResponseDto> GetPuzzleWorkspaceAsync(
            string projectId,
            CancellationToken ct,
            bool forcePuzzlePieceRegeneration = false)
        {
            if (string.IsNullOrWhiteSpace(projectId))
                throw new ArgumentException("projectId is required.");

            var deviceDocs = _db.Collection(ColDevices)
                .WhereEqualTo(nameof(Device.ProjectId), projectId)
                .GetSnapshotAsync().Result
                .Documents;

            var projectDevices = deviceDocs
                .Select(doc => doc.ConvertTo<Device>())
                .Where(device => device != null && !string.IsNullOrWhiteSpace(device.Id))
                .ToList()!;

            var deviceIdSet = projectDevices
                .Select(device => device.Id!)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var artifactDocs = _db.Collection(ColPuzzlePieces)
                .WhereEqualTo(nameof(PuzzlePieceArtifact.ProjectId), projectId)
                .GetSnapshotAsync().Result
                .Documents;

            var artifactsByKey = artifactDocs
                .Select(doc => doc.ConvertTo<PuzzlePieceArtifact>())
                .Where(artifact =>
                    artifact != null &&
                    !string.IsNullOrWhiteSpace(artifact.DeviceId) &&
                    !string.IsNullOrWhiteSpace(artifact.CameraMac))
                .ToDictionary(
                    artifact => BuildCameraKey(artifact!.DeviceId!, artifact.CameraMac!),
                    artifact => artifact!,
                    StringComparer.OrdinalIgnoreCase);

            var localDocs = _db.Collection(ColLocalHomographies).GetSnapshotAsync().Result.Documents;
            var localHomographies = localDocs
                .Select(doc => doc.ConvertTo<LocalHomography>())
                .Where(local =>
                    local != null &&
                    !string.IsNullOrWhiteSpace(local.DeviceId) &&
                    !string.IsNullOrWhiteSpace(local.CameraMac) &&
                    local.Matrix != null &&
                    deviceIdSet.Contains(local.DeviceId!))
                .OrderBy(local => local!.CameraMac)
                .ToList()!;

            var localDtos = new List<LocalHomographyWorkspaceDto>(localHomographies.Count);
            var puzzlePieces = new List<PuzzlePieceDto>(localHomographies.Count);
            var puzzlePieceMetaFiles = new List<PuzzlePieceMetadataDto>(localHomographies.Count);

            foreach (var local in localHomographies)
            {
                var localHash = ComputeHomographyHash(local.Matrix!);
                localDtos.Add(ToLocalWorkspaceDto(local, localHash));

                PuzzlePieceDto pieceDto;
                try
                {
                    pieceDto = await ResolvePuzzlePieceAsync(
                        projectId,
                        local,
                        localHash,
                        artifactsByKey,
                        ct,
                        forcePuzzlePieceRegeneration);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex,
                        "Failed to resolve puzzle piece for project={ProjectId} device={DeviceId} camera={CameraMac}",
                        projectId,
                        local.DeviceId,
                        local.CameraMac);

                    pieceDto = new PuzzlePieceDto(
                        PuzzlePieceId: BuildPuzzlePieceDocumentId(projectId, local.DeviceId!, local.CameraMac!),
                        DeviceId: local.DeviceId!,
                        CameraMac: NormalizeMac(local.CameraMac),
                        Status: "generation_failed",
                        PuzzlePiecePath: null,
                        PuzzlePieceDownloadUrl: null,
                        PuzzlePieceDownloadUrlExpiresAt: null,
                        Metadata: null,
                        Error: ex.Message);
                }

                puzzlePieces.Add(pieceDto);
                if (pieceDto.Metadata != null)
                    puzzlePieceMetaFiles.Add(pieceDto.Metadata);
            }

            var globalSnap = _db.Collection(ColGlobalHomographies).Document(projectId).GetSnapshotAsync().Result;
            var globalRecord = globalSnap.Exists
                ? globalSnap.ConvertTo<ProjectGlobalHomographySet>()
                : null;

            var globalDto = globalRecord != null ? ToGlobalHomographySetDto(globalRecord) : null;

            return new PuzzleWorkspaceResponseDto(
                ProjectId: projectId,
                PuzzlePieces: puzzlePieces,
                PuzzlePieceMetaFiles: puzzlePieceMetaFiles,
                LocalHomographies: localDtos,
                GlobalHomographies: globalDto,
                LockedGroups: globalDto?.LockedGroups ?? []);
        }

        public async Task<PuzzlePieceDto> GetPuzzlePieceAsync(
            string projectId,
            string deviceId,
            string cameraMac,
            bool forceRegeneration,
            CancellationToken ct)
        {
            ValidateRequired(projectId, nameof(projectId));
            ValidateRequired(deviceId, nameof(deviceId));
            ValidateRequired(cameraMac, nameof(cameraMac));

            var projectDeviceSnap = _db.Collection(ColDevices).Document(deviceId).GetSnapshotAsync().Result;
            if (!projectDeviceSnap.Exists)
                throw new KeyNotFoundException($"Device '{deviceId}' was not found.");

            var device = projectDeviceSnap.ConvertTo<Device>();
            if (!string.Equals(device?.ProjectId, projectId, StringComparison.OrdinalIgnoreCase))
                throw new KeyNotFoundException($"Device '{deviceId}' does not belong to project '{projectId}'.");

            var normalizedMac = NormalizeMac(cameraMac);
            var localSnap = _db.Collection(ColLocalHomographies)
                .Document($"{deviceId}_{normalizedMac}")
                .GetSnapshotAsync()
                .Result;

            if (!localSnap.Exists)
                throw new KeyNotFoundException($"No local homography was found for device '{deviceId}' camera '{normalizedMac}'.");

            var local = localSnap.ConvertTo<LocalHomography>();
            if (local == null || local.Matrix == null)
                throw new KeyNotFoundException($"Local homography for device '{deviceId}' camera '{normalizedMac}' is incomplete.");

            local.DeviceId ??= deviceId;
            local.CameraMac = normalizedMac;

            var localHash = ComputeHomographyHash(local.Matrix);
            var artifactSnap = _db.Collection(ColPuzzlePieces)
                .Document(BuildPuzzlePieceDocumentId(projectId, deviceId, normalizedMac))
                .GetSnapshotAsync()
                .Result;

            var artifactsByKey = new Dictionary<string, PuzzlePieceArtifact>(StringComparer.OrdinalIgnoreCase);
            if (artifactSnap.Exists)
            {
                var artifact = artifactSnap.ConvertTo<PuzzlePieceArtifact>();
                if (artifact != null && !string.IsNullOrWhiteSpace(artifact.DeviceId) && !string.IsNullOrWhiteSpace(artifact.CameraMac))
                    artifactsByKey[BuildCameraKey(artifact.DeviceId!, artifact.CameraMac!)] = artifact;
            }

            return await ResolvePuzzlePieceAsync(
                projectId,
                local,
                localHash,
                artifactsByKey,
                ct,
                forceRegeneration);
        }

        public SaveGlobalHomographiesResponseDto SaveGlobalHomographies(
            string projectId,
            string savedByUserId,
            SaveGlobalHomographiesDto dto)
        {
            if (string.IsNullOrWhiteSpace(projectId))
                throw new ArgumentException("projectId is required.");
            if (string.IsNullOrWhiteSpace(savedByUserId))
                throw new ArgumentException("savedByUserId is required.");
            if (dto == null)
                throw new ArgumentException("Invalid payload.");
            if (dto.MmPerFpPx <= 0)
                throw new ArgumentException("MmPerFpPx must be greater than 0.");

            var originFp = NormalizePoint(dto.OriginFp, nameof(dto.OriginFp));
            var floorplanSize = NormalizeIntPair(dto.FloorplanSize, nameof(dto.FloorplanSize));
            if (dto.Placements == null || dto.Placements.Count == 0)
                throw new ArgumentException("At least one placement is required.");

            var placements = dto.Placements.Select(placement =>
            {
                ValidateRequired(placement.PuzzlePieceId, nameof(placement.PuzzlePieceId));
                ValidateRequired(placement.DeviceId, nameof(placement.DeviceId));
                var cameraMac = NormalizeMac(placement.CameraMac);
                ValidateMatrix3x3(placement.HLocalCanvas, nameof(placement.HLocalCanvas));
                var centerFp = NormalizePoint(placement.CenterFp, nameof(placement.CenterFp));
                var localCanvasSize = NormalizeIntPair(placement.LocalCanvasSize, nameof(placement.LocalCanvasSize));

                var floorplanTransform = BuildPlacementTransform(centerFp, placement.AngleDeg, placement.Scale, localCanvasSize);
                var hLocalCanvas = ToMatrix3x3(placement.HLocalCanvas);
                var globalFloorplan = MatMul3x3(floorplanTransform, hLocalCanvas);
                var floorplanToMm = BuildFloorplanPixelToMmTransform(dto.MmPerFpPx, originFp);
                var globalMm = MatMul3x3(floorplanToMm, globalFloorplan);

                return new GlobalHomographyPlacementRecord
                {
                    PuzzlePieceId = placement.PuzzlePieceId.Trim(),
                    DeviceId = placement.DeviceId.Trim(),
                    CameraMac = cameraMac,
                    CenterFp = centerFp,
                    AngleDeg = placement.AngleDeg,
                    Scale = placement.Scale,
                    HLocalCanvas = placement.HLocalCanvas,
                    LocalCanvasSize = localCanvasSize,
                    GlobalHomographyFloorplan = FromMatrix3x3(globalFloorplan),
                    GlobalHomography = FromMatrix3x3(globalMm),
                };
            }).ToList();

            var lockedGroups = (dto.LockedGroups ?? [])
                .Where(group => !string.IsNullOrWhiteSpace(group.GroupId))
                .Select(group => new HomographyLockGroupRecord
                {
                    GroupId = group.GroupId.Trim(),
                    CameraMacs = (group.CameraMacs ?? [])
                        .Where(mac => !string.IsNullOrWhiteSpace(mac))
                        .Select(NormalizeMac)
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList(),
                })
                .Where(group => group.CameraMacs is { Count: > 0 })
                .ToList();

            var record = new ProjectGlobalHomographySet
            {
                Id = projectId,
                ProjectId = projectId,
                FloorplanId = CleanNullable(dto.FloorplanId),
                MmPerFpPx = dto.MmPerFpPx,
                OriginFp = originFp,
                FloorplanSize = floorplanSize,
                Placements = placements,
                LockedGroups = lockedGroups,
                SavedByUserId = savedByUserId,
                SavedAt = Timestamp.GetCurrentTimestamp(),
            };

            _db.Collection(ColGlobalHomographies).Document(projectId).SetAsync(record).Wait();

            var responseDto = ToGlobalHomographySetDto(record);
            return new SaveGlobalHomographiesResponseDto(
                ProjectId: projectId,
                PlacementsSaved: placements.Count,
                SavedAt: responseDto.SavedAt,
                GlobalHomographies: responseDto);
        }

        private async Task<PuzzlePieceDto> ResolvePuzzlePieceAsync(
            string projectId,
            LocalHomography local,
            string localHash,
            Dictionary<string, PuzzlePieceArtifact> artifactsByKey,
            CancellationToken ct,
            bool forceRegeneration = false)
        {
            var deviceId = local.DeviceId!;
            var cameraMac = NormalizeMac(local.CameraMac);
            var key = BuildCameraKey(deviceId, cameraMac);

            var artifact = artifactsByKey.TryGetValue(key, out var cached)
                ? cached
                : null;

            if (forceRegeneration || artifact == null || !IsUsablePuzzlePieceArtifact(artifact, localHash))
            {
                if (string.IsNullOrWhiteSpace(local.SnapshotPath))
                {
                    return new PuzzlePieceDto(
                        PuzzlePieceId: BuildPuzzlePieceDocumentId(projectId, deviceId, cameraMac),
                        DeviceId: deviceId,
                        CameraMac: cameraMac,
                        Status: "missing_snapshot",
                        PuzzlePiecePath: null,
                        PuzzlePieceDownloadUrl: null,
                        PuzzlePieceDownloadUrlExpiresAt: null,
                        Metadata: null,
                        Error: "No snapshot path is stored for this local homography.");
                }

                artifact = await GeneratePuzzlePieceAsync(projectId, local, localHash, ct);
                artifactsByKey[key] = artifact;
            }

            DownloadUrlResponseDto? download = null;
            if (!string.IsNullOrWhiteSpace(artifact.PuzzlePiecePath))
            {
                download = await _cloudStorage.CreateSignedDownloadUrlAsync(
                    new RequestDownloadUrlDto(artifact.PuzzlePiecePath),
                    ct);
            }

            DownloadUrlResponseDto? metadataDownload = null;
            if (!string.IsNullOrWhiteSpace(artifact.MetadataPath))
            {
                metadataDownload = await _cloudStorage.CreateSignedDownloadUrlAsync(
                    new RequestDownloadUrlDto(artifact.MetadataPath),
                    ct);
            }

            var metadata = ToPuzzlePieceMetadataDto(artifact, metadataDownload);
            return new PuzzlePieceDto(
                PuzzlePieceId: artifact.Id ?? BuildPuzzlePieceDocumentId(projectId, deviceId, cameraMac),
                DeviceId: deviceId,
                CameraMac: cameraMac,
                Status: "ready",
                PuzzlePiecePath: artifact.PuzzlePiecePath,
                PuzzlePieceDownloadUrl: download?.SignedUrl,
                PuzzlePieceDownloadUrlExpiresAt: download?.ExpiresAt,
                Metadata: metadata,
                Error: null);
        }

        private async Task<PuzzlePieceArtifact> GeneratePuzzlePieceAsync(
            string projectId,
            LocalHomography local,
            string localHash,
            CancellationToken ct)
        {
            if (local.Matrix == null)
                throw new InvalidOperationException("Local homography matrix is missing.");
            if (string.IsNullOrWhiteSpace(local.DeviceId))
                throw new InvalidOperationException("DeviceId is missing on local homography.");
            if (string.IsNullOrWhiteSpace(local.CameraMac))
                throw new InvalidOperationException("CameraMac is missing on local homography.");
            if (string.IsNullOrWhiteSpace(local.SnapshotPath))
                throw new InvalidOperationException("SnapshotPath is required to generate a puzzle piece.");

            var cameraMac = NormalizeMac(local.CameraMac);
            var sourceBytes = await _cloudStorage.DownloadBytesAsync(local.SnapshotPath, ct);

            using var decoded = Cv2.ImDecode(sourceBytes, ImreadModes.Unchanged);
            if (decoded.Empty())
                throw new InvalidOperationException("The stored snapshot could not be decoded.");

            using var source = EnsureBgra(decoded);
            int sourceWidth = source.Cols;
            int sourceHeight = source.Rows;

            var referenceSize = NormalizeOutputSize(local.FrameSize, sourceWidth, sourceHeight);
            var useUndistortedImage = ResolveUsedUndistortedImage(local);

            using var prepared = useUndistortedImage
                ? UndistortImage(source, local, referenceSize)
                : source.Clone();

            var hLocalCanvasRaw = FitHomographyToOutput(
                BuildEffectiveHomography(ToMatrix3x3(local.Matrix), referenceSize, sourceWidth, sourceHeight),
                sourceWidth,
                sourceHeight,
                referenceSize.Width,
                referenceSize.Height);

            using var warped = WarpBgra(
                prepared,
                hLocalCanvasRaw,
                referenceSize.Width,
                referenceSize.Height,
                InterpolationFlags.Lanczos4);

            using var trimmed = TrimTransparentBorder(warped, out var trimTransform, out var bboxTrimPct);
            var hLocalCanvas = MatMul3x3(trimTransform, hLocalCanvasRaw);

            Cv2.ImEncode(".png", trimmed, out var pngBytes);

            var objectPath = _cloudStorage.BuildObjectPath(
                $"projects/{projectId}/puzzle-pieces",
                $"{local.DeviceId}_{cameraMac}_{localHash[..8]}",
                ".png");

            using var uploadStream = new MemoryStream(pngBytes);
            await _cloudStorage.UploadFromStreamAsync(objectPath, "image/png", uploadStream, ct);

            var metadataPath = _cloudStorage.BuildObjectPath(
                $"projects/{projectId}/puzzle-pieces",
                $"{local.DeviceId}_{cameraMac}_{localHash[..8]}_meta",
                ".yml");

            var metadataYaml = BuildPuzzlePieceMetadataYaml(
                cameraMac,
                sourceWidth,
                sourceHeight,
                trimmed.Cols,
                trimmed.Rows,
                hLocalCanvas,
                useUndistortedImage,
                bboxTrimPct);

            using var metadataStream = new MemoryStream(Encoding.UTF8.GetBytes(metadataYaml));
            await _cloudStorage.UploadFromStreamAsync(metadataPath, "application/x-yaml", metadataStream, ct);

            var artifact = new PuzzlePieceArtifact
            {
                Id = BuildPuzzlePieceDocumentId(projectId, local.DeviceId, cameraMac),
                ProjectId = projectId,
                DeviceId = local.DeviceId,
                CameraMac = cameraMac,
                LocalHomographyId = local.Id ?? $"{local.DeviceId}_{cameraMac}",
                LocalHomographyHash = localHash,
                LocalHomographyMatrix = local.Matrix,
                HLocalCanvas = FromMatrix3x3(hLocalCanvas),
                SourceFrameSize = [sourceWidth, sourceHeight],
                PuzzlePieceSize = [trimmed.Cols, trimmed.Rows],
                SourceSnapshotPath = local.SnapshotPath,
                UsedUndistortedImage = useUndistortedImage,
                UndistortMode = useUndistortedImage ? "standard" : "none",
                BboxTrimPct = bboxTrimPct,
                HomographyFile = $"{cameraMac.Replace(':', '_')}_homography.yml",
                PuzzlePiecePath = objectPath,
                MetadataPath = metadataPath,
                GenerationVersion = PuzzlePieceGenerationVersion,
                GeneratedAt = Timestamp.GetCurrentTimestamp(),
            };

            _db.Collection(ColPuzzlePieces).Document(artifact.Id).SetAsync(artifact).Wait();
            return artifact;
        }

        private static bool IsUsablePuzzlePieceArtifact(PuzzlePieceArtifact artifact, string localHash)
        {
            return string.Equals(artifact.LocalHomographyHash, localHash, StringComparison.OrdinalIgnoreCase)
                && artifact.GenerationVersion >= PuzzlePieceGenerationVersion
                && !string.IsNullOrWhiteSpace(artifact.PuzzlePiecePath)
                && !string.IsNullOrWhiteSpace(artifact.MetadataPath)
                && artifact.HLocalCanvas is { Count: 3 }
                && artifact.SourceFrameSize is { Count: >= 2 }
                && artifact.PuzzlePieceSize is { Count: >= 2 };
        }

        private static LocalHomographyWorkspaceDto ToLocalWorkspaceDto(LocalHomography local, string localHash)
        {
            return new LocalHomographyWorkspaceDto(
                HomographyId: local.Id ?? $"{local.DeviceId}_{NormalizeMac(local.CameraMac)}",
                DeviceId: local.DeviceId ?? string.Empty,
                CameraMac: NormalizeMac(local.CameraMac),
                Matrix: local.Matrix ?? [],
                FrameSize: local.FrameSize ?? [],
                TimestampUnix: local.TimestampUnix,
                SnapshotPath: local.SnapshotPath,
                UsedUndistortedImage: local.UsedUndistortedImage,
                LocalHomographyHash: localHash);
        }

        private static PuzzlePieceMetadataDto ToPuzzlePieceMetadataDto(
            PuzzlePieceArtifact artifact,
            DownloadUrlResponseDto? metadataDownload)
        {
            return new PuzzlePieceMetadataDto(
                PuzzlePieceId: artifact.Id ?? string.Empty,
                DeviceId: artifact.DeviceId ?? string.Empty,
                CameraMac: NormalizeMac(artifact.CameraMac),
                LocalHomographyId: artifact.LocalHomographyId ?? string.Empty,
                LocalHomographyHash: artifact.LocalHomographyHash ?? string.Empty,
                HLocalCanvas: artifact.HLocalCanvas ?? [],
                SourceFrameSize: artifact.SourceFrameSize ?? [],
                PuzzlePieceSize: artifact.PuzzlePieceSize ?? [],
                SourceSnapshotPath: artifact.SourceSnapshotPath,
                UsedUndistortedImage: artifact.UsedUndistortedImage,
                UndistortMode: artifact.UndistortMode ?? "none",
                BboxTrimPct: artifact.BboxTrimPct,
                HomographyFile: artifact.HomographyFile ?? $"{NormalizeMac(artifact.CameraMac).Replace(':', '_')}_homography.yml",
                MetadataPath: artifact.MetadataPath,
                MetadataDownloadUrl: metadataDownload?.SignedUrl,
                MetadataDownloadUrlExpiresAt: metadataDownload?.ExpiresAt,
                GeneratedAt: artifact.GeneratedAt.ToDateTime().ToUniversalTime().ToString("o"));
        }

        private static GlobalHomographySetDto ToGlobalHomographySetDto(ProjectGlobalHomographySet record)
        {
            var placements = (record.Placements ?? [])
                .Select(placement => new GlobalHomographyPlacementDto(
                    PuzzlePieceId: placement.PuzzlePieceId ?? string.Empty,
                    DeviceId: placement.DeviceId ?? string.Empty,
                    CameraMac: NormalizeMac(placement.CameraMac),
                    CenterFp: placement.CenterFp ?? [],
                    AngleDeg: placement.AngleDeg,
                    Scale: placement.Scale,
                    HLocalCanvas: placement.HLocalCanvas ?? [],
                    LocalCanvasSize: placement.LocalCanvasSize ?? [],
                    GlobalHomographyFloorplan: placement.GlobalHomographyFloorplan ?? [],
                    GlobalHomography: placement.GlobalHomography ?? []))
                .ToList();

            var lockedGroups = (record.LockedGroups ?? [])
                .Select(group => new HomographyLockGroupDto(
                    GroupId: group.GroupId ?? string.Empty,
                    CameraMacs: (group.CameraMacs ?? [])
                        .Where(mac => !string.IsNullOrWhiteSpace(mac))
                        .Select(NormalizeMac)
                        .ToList()))
                .ToList();

            return new GlobalHomographySetDto(
                ProjectId: record.ProjectId ?? string.Empty,
                FloorplanId: record.FloorplanId,
                MmPerFpPx: record.MmPerFpPx,
                OriginFp: record.OriginFp ?? [],
                FloorplanSize: record.FloorplanSize ?? [],
                Placements: placements,
                LockedGroups: lockedGroups,
                SavedAt: record.SavedAt.ToDateTime().ToUniversalTime().ToString("o"),
                SavedByUserId: record.SavedByUserId);
        }

        private static OpenCvSharp.Size NormalizeOutputSize(List<int>? frameSize, int fallbackWidth, int fallbackHeight)
        {
            if (frameSize is { Count: >= 2 } && frameSize[0] > 0 && frameSize[1] > 0)
                return new OpenCvSharp.Size(frameSize[0], frameSize[1]);

            return new OpenCvSharp.Size(fallbackWidth, fallbackHeight);
        }

        private static bool ResolveUsedUndistortedImage(LocalHomography local)
        {
            if (local.UsedUndistortedImage.HasValue)
                return local.UsedUndistortedImage.Value;

            return local.CameraMatrix != null && local.DistortionCoefficients is { Count: >= 4 };
        }

        private static double[,] BuildEffectiveHomography(
            double[,] homography,
            OpenCvSharp.Size referenceSize,
            int imageWidth,
            int imageHeight)
        {
            double sx = referenceSize.Width / (double)imageWidth;
            double sy = referenceSize.Height / (double)imageHeight;

            return MatMul3x3(
                homography,
                new double[,]
                {
                    { sx, 0, 0 },
                    { 0, sy, 0 },
                    { 0, 0, 1 },
                });
        }

        private static double[,] ScaleCameraMatrix(
            double[,] cameraMatrix,
            OpenCvSharp.Size srcSize,
            OpenCvSharp.Size dstSize)
        {
            double sx = dstSize.Width / (double)srcSize.Width;
            double sy = dstSize.Height / (double)srcSize.Height;
            var scaled = (double[,])cameraMatrix.Clone();
            scaled[0, 0] *= sx;
            scaled[1, 1] *= sy;
            scaled[0, 2] *= sx;
            scaled[1, 2] *= sy;
            scaled[0, 1] *= sx;
            return scaled;
        }

        private static Mat UndistortImage(
            Mat sourceBgra,
            LocalHomography local,
            OpenCvSharp.Size referenceSize)
        {
            if (local.CameraMatrix == null || local.DistortionCoefficients is not { Count: >= 4 })
                throw new InvalidOperationException("Camera intrinsics are required to generate an undistorted BEV image.");

            using var sourceBgr = EnsureBgr(sourceBgra);
            using var scaledCameraMatrix = ToCvMat(
                ScaleCameraMatrix(
                    ToMatrix3x3(local.CameraMatrix),
                    referenceSize,
                    new OpenCvSharp.Size(sourceBgr.Cols, sourceBgr.Rows)));
            using var distortion = ToCvDistortion(local.DistortionCoefficients);

            using var undistortedBgr = new Mat();
            Cv2.Undistort(sourceBgr, undistortedBgr, scaledCameraMatrix, distortion);

            using var sourceMask = new Mat(sourceBgr.Rows, sourceBgr.Cols, MatType.CV_8UC1, Scalar.All(255));
            using var undistortedMask = new Mat();
            Cv2.Undistort(sourceMask, undistortedMask, scaledCameraMatrix, distortion);

            var undistortedBgra = new Mat();
            Cv2.CvtColor(undistortedBgr, undistortedBgra, ColorConversionCodes.BGR2BGRA);
            var channels = Cv2.Split(undistortedBgra);
            try
            {
                channels[3].Dispose();
                channels[3] = undistortedMask.Clone();
                Cv2.Merge(channels, undistortedBgra);
            }
            finally
            {
                foreach (var channel in channels)
                    channel.Dispose();
            }

            return undistortedBgra;
        }

        private static Mat WarpBgra(
            Mat sourceBgra,
            double[,] homography,
            int outWidth,
            int outHeight,
            InterpolationFlags interpolation)
        {
            using var transform = ToCvMat(homography);
            var warped = new Mat();
            Cv2.WarpPerspective(
                sourceBgra,
                warped,
                transform,
                new OpenCvSharp.Size(outWidth, outHeight),
                interpolation,
                BorderTypes.Constant,
                new Scalar(0, 0, 0, 0));

            using var alpha = new Mat();
            Cv2.ExtractChannel(sourceBgra, alpha, 3);
            using var warpedAlpha = new Mat();
            Cv2.WarpPerspective(
                alpha,
                warpedAlpha,
                transform,
                new OpenCvSharp.Size(outWidth, outHeight),
                interpolation,
                BorderTypes.Constant,
                Scalar.All(0));

            var channels = Cv2.Split(warped);
            try
            {
                channels[3].Dispose();
                channels[3] = warpedAlpha.Clone();
                Cv2.Merge(channels, warped);
            }
            finally
            {
                foreach (var channel in channels)
                    channel.Dispose();
            }

            return warped;
        }

        private static Mat TrimTransparentBorder(
            Mat sourceBgra,
            out double[,] trimTransform,
            out double bboxTrimPct)
        {
            trimTransform = Identity3x3();
            bboxTrimPct = 0.0;

            if (sourceBgra.Empty())
                return sourceBgra.Clone();

            int minX = sourceBgra.Cols;
            int minY = sourceBgra.Rows;
            int maxX = -1;
            int maxY = -1;

            var indexer = sourceBgra.GetGenericIndexer<Vec4b>();
            for (int y = 0; y < sourceBgra.Rows; y++)
            {
                for (int x = 0; x < sourceBgra.Cols; x++)
                {
                    if (indexer[y, x].Item3 <= 4)
                        continue;

                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }

            if (maxX < 0 || maxY < 0)
                return sourceBgra.Clone();

            int width = maxX - minX + 1;
            int height = maxY - minY + 1;
            if (minX == 0 && minY == 0 && width == sourceBgra.Cols && height == sourceBgra.Rows)
                return sourceBgra.Clone();

            bboxTrimPct = 100.0 * (1.0 - ((double)width * height) / (sourceBgra.Cols * sourceBgra.Rows));
            trimTransform = new double[,]
            {
                { 1, 0, -minX },
                { 0, 1, -minY },
                { 0, 0, 1 },
            };

            return new Mat(sourceBgra, new Rect(minX, minY, width, height)).Clone();
        }

        private static string BuildPuzzlePieceMetadataYaml(
            string cameraMac,
            int sourceWidth,
            int sourceHeight,
            int bevWidth,
            int bevHeight,
            double[,] compositeMatrix,
            bool usedUndistortedImage,
            double bboxTrimPct = 0.0)
        {
            var serializer = new SerializerBuilder().Build();
            var metadata = new Dictionary<string, object>
            {
                ["bbox_trim_pct"] = bboxTrimPct,
                ["bev_size"] = new[] { bevWidth, bevHeight },
                ["composite_matrix"] = FromMatrix3x3(compositeMatrix),
                ["homography_file"] = $"{cameraMac.Replace(':', '_')}_homography.yml",
                ["source_image_size"] = new[] { sourceWidth, sourceHeight },
                ["undistort_mode"] = usedUndistortedImage ? "standard" : "none",
                ["used_undistorted_image"] = usedUndistortedImage ? 1 : 0,
            };

            return serializer.Serialize(metadata);
        }

        private static double[,] FitHomographyToOutput(
            double[,] homography,
            int srcWidth,
            int srcHeight,
            int outWidth,
            int outHeight)
        {
            var corners = new List<(double x, double y)>
            {
                (0, 0),
                (srcWidth - 1, 0),
                (srcWidth - 1, srcHeight - 1),
                (0, srcHeight - 1),
            };

            var warped = corners
                .Select(corner => ApplyHomographyPoint(homography, corner.x, corner.y))
                .Where(point => point.Count >= 2)
                .ToList();

            if (warped.Count == 0)
                return homography;

            var xs = warped.Select(point => point[0]).ToList();
            var ys = warped.Select(point => point[1]).ToList();
            double minX = xs.Min();
            double minY = ys.Min();
            double maxX = xs.Max();
            double maxY = ys.Max();
            double bboxWidth = maxX - minX;
            double bboxHeight = maxY - minY;

            if (bboxWidth < 1e-6 || bboxHeight < 1e-6)
                return homography;

            double scale = Math.Min(outWidth / bboxWidth, outHeight / bboxHeight);
            double padX = (outWidth - bboxWidth * scale) / 2.0;
            double padY = (outHeight - bboxHeight * scale) / 2.0;

            var fit = new double[,]
            {
                { scale, 0, padX - scale * minX },
                { 0, scale, padY - scale * minY },
                { 0, 0, 1 },
            };

            return MatMul3x3(fit, homography);
        }

        private static double[,] BuildPlacementTransform(List<double> centerFp, double angleDeg, double scale, List<int> localCanvasSize)
        {
            if (localCanvasSize.Count < 2 || localCanvasSize[0] <= 0 || localCanvasSize[1] <= 0)
                throw new ArgumentException("LocalCanvasSize must contain positive width and height.");

            double pivotX = localCanvasSize[0] / 2.0;
            double pivotY = localCanvasSize[1] / 2.0;
            double angle = angleDeg * Math.PI / 180.0;
            double cos = Math.Cos(angle) * scale;
            double sin = Math.Sin(angle) * scale;
            double centerX = centerFp[0];
            double centerY = centerFp[1];

            return new double[,]
            {
                { cos, -sin, centerX - cos * pivotX + sin * pivotY },
                { sin,  cos, centerY - sin * pivotX - cos * pivotY },
                { 0, 0, 1 },
            };
        }

        private static double[,] BuildFloorplanPixelToMmTransform(double mmPerFpPx, List<double> originFp)
        {
            return new double[,]
            {
                { mmPerFpPx, 0, -originFp[0] * mmPerFpPx },
                { 0, -mmPerFpPx, originFp[1] * mmPerFpPx },
                { 0, 0, 1 },
            };
        }

        private static Mat EnsureBgra(Mat source)
        {
            if (source.Channels() == 4)
                return source.Clone();

            var converted = new Mat();
            if (source.Channels() == 3)
                Cv2.CvtColor(source, converted, ColorConversionCodes.BGR2BGRA);
            else if (source.Channels() == 1)
                Cv2.CvtColor(source, converted, ColorConversionCodes.GRAY2BGRA);
            else
                throw new InvalidOperationException("Unsupported snapshot image format.");

            return converted;
        }

        private static Mat EnsureBgr(Mat source)
        {
            if (source.Channels() == 3)
                return source.Clone();

            var converted = new Mat();
            if (source.Channels() == 4)
                Cv2.CvtColor(source, converted, ColorConversionCodes.BGRA2BGR);
            else if (source.Channels() == 1)
                Cv2.CvtColor(source, converted, ColorConversionCodes.GRAY2BGR);
            else
                throw new InvalidOperationException("Unsupported snapshot image format.");

            return converted;
        }

        private static Mat ToCvMat(double[,] matrix)
        {
            var cv = new Mat(3, 3, MatType.CV_64FC1);
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++)
                    cv.Set(i, j, matrix[i, j]);
            return cv;
        }

        private static Mat ToCvDistortion(IReadOnlyList<double> distortion)
        {
            var cv = new Mat(1, distortion.Count, MatType.CV_64FC1);
            for (int i = 0; i < distortion.Count; i++)
                cv.Set(0, i, distortion[i]);
            return cv;
        }

        private static List<double> NormalizePoint(List<double>? point, string parameterName)
        {
            if (point == null || point.Count < 2)
                throw new ArgumentException($"{parameterName} must contain two numeric values.");

            return [point[0], point[1]];
        }

        private static List<int> NormalizeIntPair(List<int>? values, string parameterName)
        {
            if (values == null || values.Count < 2 || values[0] <= 0 || values[1] <= 0)
                throw new ArgumentException($"{parameterName} must contain positive width and height values.");

            return [values[0], values[1]];
        }

        private static void ValidateRequired(string? value, string parameterName)
        {
            if (string.IsNullOrWhiteSpace(value))
                throw new ArgumentException($"{parameterName} is required.");
        }

        private static void ValidateMatrix3x3(List<List<double>>? matrix, string parameterName)
        {
            if (matrix == null || matrix.Count != 3 || matrix.Any(row => row == null || row.Count != 3))
                throw new ArgumentException($"{parameterName} must be a 3x3 matrix.");
        }

        private static string? CleanNullable(string? value)
        {
            var cleaned = value?.Trim();
            return string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
        }

        private static string BuildPuzzlePieceDocumentId(string projectId, string deviceId, string cameraMac)
        {
            return $"{projectId}__{deviceId}__{NormalizeMac(cameraMac).Replace(':', '_')}";
        }

        private static string BuildCameraKey(string deviceId, string cameraMac)
        {
            return $"{deviceId}::{NormalizeMac(cameraMac)}";
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

        public bool HasLocalHomography(string deviceId)
        {
            var snap = _db.Collection(ColLocalHomographies)
            .WhereEqualTo(nameof(LocalHomography.DeviceId), deviceId)
            .Limit(1)
            .GetSnapshotAsync().Result;
            return snap.Documents.Count > 0;
        }

        public async Task<string?> GetSnapshotUrlAsync(string deviceId, string cameraMac, CancellationToken ct)
        {
            var docId = $"{deviceId}_{NormalizeMac(cameraMac)}";
            var snap = await _db.Collection(ColLocalHomographies).Document(docId).GetSnapshotAsync(ct);
            if (!snap.Exists) return null;

            var record = snap.ConvertTo<LocalHomography>();
            if (string.IsNullOrWhiteSpace(record?.SnapshotPath)) return null;

            var dto = await _cloudStorage.CreateSignedDownloadUrlAsync(
                new RequestDownloadUrlDto(record.SnapshotPath), ct);
            return dto.SignedUrl;
        }
    }
}

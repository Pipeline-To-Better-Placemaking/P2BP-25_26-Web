using BetterPlacemaking.Models.Dtos;
using BetterPlacemaking.Models.Homography;
using Google.Cloud.Firestore;
using Microsoft.Extensions.Logging;

namespace BetterPlacemaking.Services
{
    public class IntrinsicsService(FirestoreDb db, ILogger<IntrinsicsService> logger)
    {
        private readonly FirestoreDb _db = db;
        private readonly ILogger<IntrinsicsService> _logger = logger;

        private const string ColSightings = "intrinsics_sightings";
        private const string ColIntrinsics = "camera_intrinsics";

        public IntrinsicsSightingsResponseDto SubmitSightings(string deviceId, SubmitIntrinsicsSightingsDto dto)
        {
            var mac = NormalizeMac(dto.CameraMac);
            var batch = _db.StartBatch();
            int count = 0;

            foreach (var s in dto.Sightings)
            {
                var docId = $"{deviceId}_{mac}_{s.CapturedAt.Replace(":", "-").Replace("+", "p")}_{Guid.NewGuid():N}";
                var docRef = _db.Collection(ColSightings).Document(docId);
                var record = new IntrinsicsSighting
                {
                    ModelId = dto.IsPerUnit ? null : dto.ModelId,
                    DeviceId = deviceId,
                    CameraMac = mac,
                    IsPerUnit = dto.IsPerUnit,
                    CapturedAt = s.CapturedAt,
                    ImagePoints = s.ImagePoints,
                    CornerIds = s.CornerIds,
                    FrameSize = s.FrameSize,
                    Rmse = s.Rmse,
                };
                batch.Set(docRef, record);
                count++;
            }

            batch.CommitAsync().Wait();
            _logger.LogInformation(
                "Stored {Count} intrinsics sightings for device={DeviceId} camera={Mac}",
                count, deviceId, mac);

            return new IntrinsicsSightingsResponseDto(count);
        }

        public IntrinsicsResultResponseDto StoreResult(string deviceId, SubmitIntrinsicsResultDto dto)
        {
            var mac = NormalizeMac(dto.CameraMac);
            string docId = dto.IsPerUnit
                ? $"{deviceId}_{mac}"
                : (dto.ModelId ?? mac);

            var docRef = _db.Collection(ColIntrinsics).Document(docId);
            var record = new CameraIntrinsics
            {
                ModelId = dto.IsPerUnit ? null : dto.ModelId,
                DeviceId = dto.IsPerUnit ? deviceId : null,
                CameraMac = dto.IsPerUnit ? mac : null,
                IsPerUnit = dto.IsPerUnit,
                CameraMatrix = dto.CameraMatrix,
                DistortionCoefficients = dto.DistortionCoefficients,
                ReprojectionError = dto.ReprojectionError,
                SightingsUsed = dto.SightingsUsed,
                ComputedAtUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            };

            docRef.SetAsync(record).Wait();
            _logger.LogInformation(
                "Stored intrinsics result for device={DeviceId} camera={Mac} isPerUnit={IsPerUnit} rmse={Rmse}",
                deviceId, mac, dto.IsPerUnit, dto.ReprojectionError);

            return ToResponseDto(docId, record);
        }

        public IntrinsicsResultResponseDto? GetIntrinsics(string deviceId, string mac, string? modelId = null)
        {
            var normMac = NormalizeMac(mac);

            // Per-unit record takes priority.
            var perUnitId = $"{deviceId}_{normMac}";
            var perUnitSnap = _db.Collection(ColIntrinsics).Document(perUnitId).GetSnapshotAsync().Result;
            if (perUnitSnap.Exists)
            {
                var record = perUnitSnap.ConvertTo<CameraIntrinsics>();
                if (record?.CameraMatrix != null)
                    return ToResponseDto(perUnitId, record);
            }

            // Fall back to model-level intrinsics if modelId is known.
            if (!string.IsNullOrWhiteSpace(modelId))
                return GetModelIntrinsics(modelId);

            return null;
        }

        public IntrinsicsResultResponseDto? GetModelIntrinsics(string modelId)
        {
            var snap = _db.Collection(ColIntrinsics).Document(modelId).GetSnapshotAsync().Result;
            if (!snap.Exists)
                return null;

            var record = snap.ConvertTo<CameraIntrinsics>();
            if (record?.CameraMatrix == null)
                return null;

            return ToResponseDto(modelId, record);
        }

        private static IntrinsicsResultResponseDto ToResponseDto(string id, CameraIntrinsics r) =>
            new(
                id,
                r.CameraMac,
                r.ModelId,
                r.IsPerUnit,
                r.CameraMatrix!,
                r.DistortionCoefficients!,
                r.ReprojectionError,
                r.SightingsUsed,
                r.ComputedAtUnix
            );

        private static string NormalizeMac(string? mac) =>
            (mac ?? string.Empty).Trim().ToLowerInvariant();
    }
}

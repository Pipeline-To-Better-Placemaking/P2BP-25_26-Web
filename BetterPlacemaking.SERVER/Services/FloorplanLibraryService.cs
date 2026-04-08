using BetterPlacemaking.Models;
using BetterPlacemaking.Models.Dtos;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using OpenCvSharp;

namespace BetterPlacemaking.Services
{
    public sealed class FloorplanLibraryService(FirestoreDb db, CloudStorageService cloudStorage)
    {
        private readonly FirestoreDb _db = db;
        private readonly CloudStorageService _cloudStorage = cloudStorage;
        private const string CollectionName = "floorplan_library";

        public async Task<List<FloorplanLibraryItem>> ListForUserAsync(string userId, string? projectId)
        {
            if (string.IsNullOrWhiteSpace(userId))
                return [];

            Query query = _db.Collection(CollectionName)
                .WhereEqualTo(nameof(FloorplanLibraryItem.UserId), userId);

            var normalizedProjectId = CleanNullable(projectId);
            if (!string.IsNullOrWhiteSpace(normalizedProjectId))
                query = query.WhereEqualTo(nameof(FloorplanLibraryItem.ProjectId), normalizedProjectId);

            var snapshot = await query.GetSnapshotAsync();

            return snapshot.Documents
                .Select(doc => doc.ConvertTo<FloorplanLibraryItem>())
                .Where(item => item != null)
                .OrderByDescending(item => item!.UpdatedAtUtc)
                .ToList()!;
        }

        public async Task<FloorplanLibraryItem?> GetByIdForUserAsync(string userId, string id)
        {
            if (string.IsNullOrWhiteSpace(userId) || string.IsNullOrWhiteSpace(id))
                return null;

            var snapshot = await _db.Collection(CollectionName).Document(id).GetSnapshotAsync();
            if (!snapshot.Exists)
                return null;

            var item = snapshot.ConvertTo<FloorplanLibraryItem>();
            if (item == null || !string.Equals(item.UserId, userId, StringComparison.Ordinal))
                return null;

            return item;
        }

        public async Task<FloorplanLibraryItem> UploadForUserAsync(
            string userId,
            IFormFile image,
            string? nickname,
            string? projectId,
            CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(userId))
                throw new ArgumentException("Missing user id.");
            if (image == null || image.Length <= 0)
                throw new ArgumentException("A floorplan image is required.");

            string contentType = NormalizeImageContentType(image.ContentType);
            string extension = NormalizeImageExtension(image.FileName, contentType);
            string normalizedProjectId = CleanNullable(projectId) ?? "shared";

            byte[] fileBytes;
            await using (var readStream = image.OpenReadStream())
            using (var memory = new MemoryStream())
            {
                await readStream.CopyToAsync(memory, ct);
                fileBytes = memory.ToArray();
            }

            using var decoded = Cv2.ImDecode(fileBytes, ImreadModes.Unchanged);
            if (decoded.Empty())
                throw new ArgumentException("The uploaded file is not a valid image.");

            var collection = _db.Collection(CollectionName);
            var docRef = collection.Document();
            var createdAtUtc = DateTime.UtcNow;

            string objectPath = _cloudStorage.BuildObjectPath(
                $"users/{userId}/floorplans/{normalizedProjectId}",
                $"{docRef.Id}_{Path.GetFileNameWithoutExtension(image.FileName)}",
                extension);

            await using (var uploadStream = new MemoryStream(fileBytes))
            {
                await _cloudStorage.UploadFromStreamAsync(objectPath, contentType, uploadStream, ct);
            }

            var item = new FloorplanLibraryItem
            {
                Id = docRef.Id,
                UserId = userId,
                ProjectId = CleanNullable(projectId),
                Nickname = NormalizeNickname(nickname, image.FileName),
                ImagePath = objectPath,
                ImageContentType = contentType,
                ImageSizeBytes = image.Length,
                ImageWidth = decoded.Cols,
                ImageHeight = decoded.Rows,
                Calibration = null,
                CreatedAtUtc = createdAtUtc,
                UpdatedAtUtc = createdAtUtc,
            };

            await docRef.SetAsync(item);
            return item;
        }

        public async Task<FloorplanLibraryItem> UpdateForUserAsync(
            string userId,
            string id,
            UpdateFloorplanLibraryItemDto dto)
        {
            if (string.IsNullOrWhiteSpace(userId))
                throw new ArgumentException("Missing user id.");
            if (string.IsNullOrWhiteSpace(id))
                throw new ArgumentException("id is required.");
            if (dto == null)
                throw new ArgumentException("Invalid payload.");

            var docRef = _db.Collection(CollectionName).Document(id);
            var snapshot = await docRef.GetSnapshotAsync();
            if (!snapshot.Exists)
                throw new KeyNotFoundException("Floorplan not found.");

            var existing = snapshot.ConvertTo<FloorplanLibraryItem>();
            if (existing == null || !string.Equals(existing.UserId, userId, StringComparison.Ordinal))
                throw new KeyNotFoundException("Floorplan not found.");

            existing.Nickname = dto.Nickname != null
                ? NormalizeNickname(dto.Nickname, existing.Nickname ?? existing.Id ?? "Floorplan")
                : existing.Nickname;
            existing.ProjectId = dto.ProjectId != null
                ? CleanNullable(dto.ProjectId)
                : existing.ProjectId;
            existing.Calibration = MergeCalibration(existing, dto);
            existing.UpdatedAtUtc = DateTime.UtcNow;

            await docRef.SetAsync(existing);
            return existing;
        }

        public async Task<bool> DeleteForUserAsync(string userId, string id)
        {
            if (string.IsNullOrWhiteSpace(userId) || string.IsNullOrWhiteSpace(id))
                return false;

            var docRef = _db.Collection(CollectionName).Document(id);
            var snapshot = await docRef.GetSnapshotAsync();
            if (!snapshot.Exists)
                return false;

            var existing = snapshot.ConvertTo<FloorplanLibraryItem>();
            if (existing == null || !string.Equals(existing.UserId, userId, StringComparison.Ordinal))
                return false;

            await docRef.DeleteAsync();
            return true;
        }

        private static FloorplanCalibrationRecord? MergeCalibration(
            FloorplanLibraryItem existing,
            UpdateFloorplanLibraryItemDto dto)
        {
            bool calibrationTouched =
                dto.ReferencePoints != null ||
                dto.ReferenceDistanceMm.HasValue ||
                dto.MmPerPixel.HasValue ||
                dto.OriginFp != null;

            if (!calibrationTouched)
                return existing.Calibration;

            var existingCalibration = existing.Calibration;
            var referencePoints = dto.ReferencePoints ?? existingCalibration?.ReferencePoints;
            var referenceDistanceMm = dto.ReferenceDistanceMm ?? existingCalibration?.ReferenceDistanceMm;

            if (referencePoints == null || referencePoints.Count != 2 || referencePoints.Any(point => point == null || point.Count < 2))
                throw new ArgumentException("ReferencePoints must contain exactly two [x, y] points.");

            double mmPerPixel;
            if (dto.MmPerPixel.HasValue)
            {
                mmPerPixel = dto.MmPerPixel.Value;
            }
            else
            {
                if (!referenceDistanceMm.HasValue || referenceDistanceMm.Value <= 0)
                    throw new ArgumentException("ReferenceDistanceMm must be greater than 0.");

                var dx = referencePoints[1][0] - referencePoints[0][0];
                var dy = referencePoints[1][1] - referencePoints[0][1];
                var distancePixels = Math.Sqrt(dx * dx + dy * dy);
                if (distancePixels <= 0)
                    throw new ArgumentException("ReferencePoints must be distinct.");

                mmPerPixel = referenceDistanceMm.Value / distancePixels;
            }

            if (mmPerPixel <= 0)
                throw new ArgumentException("MmPerPixel must be greater than 0.");

            var originFp = dto.OriginFp ?? existingCalibration?.OriginFp ?? [0, existing.ImageHeight - 1.0];
            if (originFp.Count < 2)
                throw new ArgumentException("OriginFp must contain two numeric values.");

            return new FloorplanCalibrationRecord
            {
                ReferencePoints = referencePoints
                    .Select(point => new List<double> { point[0], point[1] })
                    .ToList(),
                ReferenceDistanceMm = referenceDistanceMm ?? existingCalibration?.ReferenceDistanceMm ?? 0,
                MmPerPixel = mmPerPixel,
                OriginFp = [originFp[0], originFp[1]],
                CalibratedAtUtc = DateTime.UtcNow,
            };
        }

        private static string NormalizeNickname(string? rawNickname, string fallback)
        {
            var cleaned = (rawNickname ?? string.Empty).Trim();
            if (cleaned.Length > 120)
                cleaned = cleaned[..120].Trim();

            if (!string.IsNullOrWhiteSpace(cleaned))
                return cleaned;

            var fallbackName = Path.GetFileNameWithoutExtension(fallback ?? string.Empty).Trim();
            if (fallbackName.Length > 120)
                fallbackName = fallbackName[..120].Trim();

            return string.IsNullOrWhiteSpace(fallbackName)
                ? $"Floorplan {DateTime.UtcNow:yyyy-MM-dd HH:mm}"
                : fallbackName;
        }

        private static string NormalizeImageContentType(string? rawContentType)
        {
            var contentType = (rawContentType ?? string.Empty).Trim().ToLowerInvariant();
            if (!contentType.StartsWith("image/", StringComparison.Ordinal))
                throw new ArgumentException("The uploaded file must be an image.");

            return contentType;
        }

        private static string NormalizeImageExtension(string fileName, string contentType)
        {
            var ext = Path.GetExtension(fileName ?? string.Empty)?.Trim().ToLowerInvariant();
            if (ext is ".png" or ".jpg" or ".jpeg" or ".webp")
                return ext;

            return contentType switch
            {
                "image/png" => ".png",
                "image/jpeg" => ".jpg",
                "image/webp" => ".webp",
                _ => throw new ArgumentException("Unsupported floorplan image type."),
            };
        }

        private static string? CleanNullable(string? value)
        {
            var cleaned = value?.Trim();
            return string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
        }
    }
}

using BetterPlacemaking.Models;
using BetterPlacemaking.Models.Dtos;
using Google.Cloud.Firestore;

namespace BetterPlacemaking.Services
{
    public sealed class BoardLibraryService(FirestoreDb db)
    {
        private readonly FirestoreDb _db = db;
        private const string CollectionName = "board_library";

        private static readonly Dictionary<string, int> DictionaryMaxMarkerId = new(StringComparer.OrdinalIgnoreCase)
        {
            ["DICT_4X4_50"] = 49,
            ["DICT_4X4_100"] = 99,
            ["DICT_5X5_50"] = 49,
            ["DICT_5X5_100"] = 99,
            ["DICT_6X6_50"] = 49,
            ["DICT_6X6_100"] = 99,
        };

        public List<BoardLibraryItem> ListForUser(string userId)
        {
            if (string.IsNullOrWhiteSpace(userId))
                return [];

            var snapshot = _db.Collection(CollectionName)
                .WhereEqualTo(nameof(BoardLibraryItem.UserId), userId)
                .GetSnapshotAsync().Result;

            return snapshot.Documents
                .Select(doc => doc.ConvertTo<BoardLibraryItem>())
                .Where(item => item != null)
                .OrderByDescending(item => item!.CreatedAtUtc)
                .ToList()!;
        }

        public BoardLibraryItem? GetByIdForUser(string userId, string id)
        {
            if (string.IsNullOrWhiteSpace(userId) || string.IsNullOrWhiteSpace(id))
                return null;

            var snapshot = _db.Collection(CollectionName).Document(id).GetSnapshotAsync().Result;
            if (!snapshot.Exists)
                return null;

            var item = snapshot.ConvertTo<BoardLibraryItem>();
            if (item == null || !string.Equals(item.UserId, userId, StringComparison.Ordinal))
                return null;

            return item;
        }

        public BoardLibraryItem SaveForUser(string userId, SaveBoardLibraryItemDto dto)
        {
            if (string.IsNullOrWhiteSpace(userId))
                throw new ArgumentException("Missing user id.");

            var docRef = _db.Collection(CollectionName).Document();
            var item = BuildValidatedItem(userId, dto, docRef.Id, DateTime.UtcNow);
            docRef.SetAsync(item).Wait();

            return item;
        }

        public BoardLibraryItem UpdateForUser(string userId, string id, SaveBoardLibraryItemDto dto)
        {
            if (string.IsNullOrWhiteSpace(userId))
                throw new ArgumentException("Missing user id.");
            if (string.IsNullOrWhiteSpace(id))
                throw new ArgumentException("id is required.");

            var docRef = _db.Collection(CollectionName).Document(id);
            var snapshot = docRef.GetSnapshotAsync().Result;
            if (!snapshot.Exists)
                throw new KeyNotFoundException("Board not found.");

            var existing = snapshot.ConvertTo<BoardLibraryItem>();
            if (existing == null || !string.Equals(existing.UserId, userId, StringComparison.Ordinal))
                throw new KeyNotFoundException("Board not found.");

            var updated = BuildValidatedItem(userId, dto, id, existing.CreatedAtUtc);
            docRef.SetAsync(updated).Wait();
            return updated;
        }

        public bool DeleteForUser(string userId, string id)
        {
            if (string.IsNullOrWhiteSpace(userId) || string.IsNullOrWhiteSpace(id))
                return false;

            var docRef = _db.Collection(CollectionName).Document(id);
            var snapshot = docRef.GetSnapshotAsync().Result;
            if (!snapshot.Exists)
                return false;

            var existing = snapshot.ConvertTo<BoardLibraryItem>();
            if (existing == null || !string.Equals(existing.UserId, userId, StringComparison.Ordinal))
                return false;

            docRef.DeleteAsync().Wait();
            return true;
        }

        private static BoardLibraryItem BuildValidatedItem(
            string userId,
            SaveBoardLibraryItemDto dto,
            string id,
            DateTime createdAtUtc)
        {
            var type = NormalizeBoardType(dto.Type);
            var dictionary = NormalizeDictionary(dto.Dictionary);
            var units = NormalizeUnits(dto.Units);
            var nickname = NormalizeNickname(dto.Nickname, type);
            var previewSvg = NormalizePreviewSvg(dto.PreviewSvg);

            ValidateDimensions(type, dictionary, dto.Cols, dto.Rows, dto.MarkerId, dto.SquareSize, dto.MarkerSize);

            var markerSizeMm = ConvertToMm(dto.MarkerSize, units);
            double? squareSizeMm = type == "charuco" && dto.SquareSize.HasValue
                ? ConvertToMm(dto.SquareSize.Value, units)
                : null;

            return new BoardLibraryItem
            {
                Id = id,
                UserId = userId,
                Type = type,
                Nickname = nickname,
                Dictionary = dictionary,
                Units = units,
                Cols = type == "charuco" ? dto.Cols : null,
                Rows = type == "charuco" ? dto.Rows : null,
                MarkerId = type == "aruco" ? dto.MarkerId : null,
                SquareSize = type == "charuco" ? dto.SquareSize : null,
                MarkerSize = dto.MarkerSize,
                SquareSizeMm = squareSizeMm,
                MarkerSizeMm = markerSizeMm,
                PreviewSvg = previewSvg,
                CreatedAtUtc = createdAtUtc,
            };
        }

        private static string NormalizeBoardType(string rawType)
        {
            var normalized = (rawType ?? string.Empty).Trim().ToLowerInvariant();
            if (normalized is "charuco" or "aruco")
                return normalized;

            throw new ArgumentException("Type must be 'charuco' or 'aruco'.");
        }

        private static string NormalizeDictionary(string rawDictionary)
        {
            var normalized = (rawDictionary ?? string.Empty).Trim().ToUpperInvariant();
            if (DictionaryMaxMarkerId.ContainsKey(normalized))
                return normalized;

            throw new ArgumentException("Unsupported dictionary.");
        }

        private static string NormalizeUnits(string rawUnits)
        {
            var normalized = (rawUnits ?? string.Empty).Trim().ToLowerInvariant();
            if (normalized is "mm" or "cm" or "in")
                return normalized;

            throw new ArgumentException("Units must be mm, cm, or in.");
        }

        private static string NormalizeNickname(string? rawNickname, string type)
        {
            var cleaned = (rawNickname ?? string.Empty).Trim();
            if (cleaned.Length > 120)
                cleaned = cleaned[..120].Trim();

            if (!string.IsNullOrWhiteSpace(cleaned))
                return cleaned;

            var prettyType = type == "charuco" ? "ChArUco" : "ArUco";
            return $"{prettyType} Board {DateTime.UtcNow:yyyy-MM-dd HH:mm}";
        }

        private static string NormalizePreviewSvg(string rawPreviewSvg)
        {
            var cleaned = (rawPreviewSvg ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(cleaned))
                throw new ArgumentException("PreviewSvg is required.");

            if (!cleaned.StartsWith("<svg", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("PreviewSvg must be an SVG document.");

            if (cleaned.Length > 900_000)
                throw new ArgumentException("PreviewSvg is too large.");

            return cleaned;
        }

        private static void ValidateDimensions(
            string type,
            string dictionary,
            int? cols,
            int? rows,
            int? markerId,
            double? squareSize,
            double markerSize)
        {
            if (markerSize <= 0)
                throw new ArgumentException("MarkerSize must be greater than 0.");

            if (type == "charuco")
            {
                if (!cols.HasValue || cols.Value < 2)
                    throw new ArgumentException("Cols must be at least 2 for ChArUco boards.");

                if (!rows.HasValue || rows.Value < 2)
                    throw new ArgumentException("Rows must be at least 2 for ChArUco boards.");

                if (!squareSize.HasValue || squareSize.Value <= 0)
                    throw new ArgumentException("SquareSize must be greater than 0 for ChArUco boards.");

                if (markerSize >= squareSize.Value)
                    throw new ArgumentException("MarkerSize must be smaller than SquareSize for ChArUco boards.");

                return;
            }

            if (!markerId.HasValue)
                throw new ArgumentException("MarkerId is required for ArUco markers.");

            var maxId = DictionaryMaxMarkerId[dictionary];
            if (markerId.Value < 0 || markerId.Value > maxId)
                throw new ArgumentException($"MarkerId must be between 0 and {maxId} for {dictionary}.");
        }

        private static double ConvertToMm(double value, string units)
        {
            return units switch
            {
                "mm" => value,
                "cm" => value * 10.0,
                "in" => value * 25.4,
                _ => throw new ArgumentException("Unsupported units."),
            };
        }
    }
}

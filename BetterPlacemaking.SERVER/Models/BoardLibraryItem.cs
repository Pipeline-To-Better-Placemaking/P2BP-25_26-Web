using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models
{
    [FirestoreData]
    public class BoardLibraryItem
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string UserId { get; set; } = string.Empty;

        [FirestoreProperty]
        public string Type { get; set; } = "charuco";

        [FirestoreProperty]
        public string Nickname { get; set; } = string.Empty;

        [FirestoreProperty]
        public string Dictionary { get; set; } = "DICT_4X4_50";

        [FirestoreProperty]
        public string Units { get; set; } = "mm";

        [FirestoreProperty]
        public int? Cols { get; set; }

        [FirestoreProperty]
        public int? Rows { get; set; }

        [FirestoreProperty]
        public int? MarkerId { get; set; }

        [FirestoreProperty]
        public double? SquareSize { get; set; }

        [FirestoreProperty]
        public double MarkerSize { get; set; }

        [FirestoreProperty]
        public double? SquareSizeMm { get; set; }

        [FirestoreProperty]
        public double MarkerSizeMm { get; set; }

        [FirestoreProperty]
        public string PreviewSvg { get; set; } = string.Empty;

        [FirestoreProperty]
        public DateTime CreatedAtUtc { get; set; }
    }
}

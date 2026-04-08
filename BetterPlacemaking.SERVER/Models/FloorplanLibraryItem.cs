using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models
{
    [FirestoreData]
    public sealed class FloorplanLibraryItem
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? UserId { get; set; }

        [FirestoreProperty]
        public string? ProjectId { get; set; }

        [FirestoreProperty]
        public string? Nickname { get; set; }

        [FirestoreProperty]
        public string? ImagePath { get; set; }

        [FirestoreProperty]
        public string? ImageContentType { get; set; }

        [FirestoreProperty]
        public long ImageSizeBytes { get; set; }

        [FirestoreProperty]
        public int ImageWidth { get; set; }

        [FirestoreProperty]
        public int ImageHeight { get; set; }

        [FirestoreProperty]
        public FloorplanCalibrationRecord? Calibration { get; set; }

        [FirestoreProperty]
        public DateTime CreatedAtUtc { get; set; }

        [FirestoreProperty]
        public DateTime UpdatedAtUtc { get; set; }
    }

    [FirestoreData]
    public sealed class FloorplanCalibrationRecord
    {
        [FirestoreProperty]
        public List<List<double>>? ReferencePoints { get; set; }

        [FirestoreProperty]
        public double ReferenceDistanceMm { get; set; }

        [FirestoreProperty]
        public double MmPerPixel { get; set; }

        [FirestoreProperty]
        public List<double>? OriginFp { get; set; }

        [FirestoreProperty]
        public DateTime CalibratedAtUtc { get; set; }
    }
}

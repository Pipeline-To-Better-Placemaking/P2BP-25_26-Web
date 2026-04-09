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
        // Firestore does not support nested arrays; flatten to [x0,y0, x1,y1, ...] and reconstruct on read.
        [FirestoreProperty]
        public List<double>? ReferencePointsFlat { get; set; }

        public List<List<double>>? ReferencePoints
        {
            get => ReferencePointsFlat is { Count: >= 2 } flat && flat.Count % 2 == 0
                ? Enumerable.Range(0, flat.Count / 2).Select(i => flat.GetRange(i * 2, 2)).ToList()
                : null;
            set => ReferencePointsFlat = value?.SelectMany(r => r).ToList();
        }

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

using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.Homography
{
    [FirestoreData]
    public class LockedHomography
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? DeviceId { get; set; }

        [FirestoreProperty]
        public string? CameraMac { get; set; }

        // Firestore does not support nested arrays; store 3x3 matrix flattened (9 elements).
        [FirestoreProperty]
        public List<double>? MatrixFlat { get; set; }

        public List<List<double>>? Matrix
        {
            get => MatrixFlat is { Count: 9 }
                ? Enumerable.Range(0, 3).Select(i => MatrixFlat.GetRange(i * 3, 3)).ToList()
                : null;
            set => MatrixFlat = value?.SelectMany(r => r).ToList();
        }

        [FirestoreProperty]
        public Timestamp ComputedAt { get; set; }

        [FirestoreProperty]
        public bool UsedUndistortedImage { get; set; }
    }
}

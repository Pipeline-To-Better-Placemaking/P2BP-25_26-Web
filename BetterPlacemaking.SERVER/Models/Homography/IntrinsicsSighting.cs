using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.Homography
{
    [FirestoreData]
    public class IntrinsicsSighting
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? ModelId { get; set; }  // null for per-unit

        [FirestoreProperty]
        public string? DeviceId { get; set; }

        [FirestoreProperty]
        public string? CameraMac { get; set; }

        [FirestoreProperty]
        public bool IsPerUnit { get; set; }

        [FirestoreProperty]
        public string? CapturedAt { get; set; }

        [FirestoreProperty]
        public List<List<double>>? ImagePoints { get; set; }  // [[x,y], ...]

        [FirestoreProperty]
        public List<int>? CornerIds { get; set; }

        [FirestoreProperty]
        public List<int>? FrameSize { get; set; }  // [width, height]

        [FirestoreProperty]
        public double Rmse { get; set; }
    }
}

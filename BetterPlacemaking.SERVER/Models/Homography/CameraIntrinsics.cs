using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.Homography
{
    [FirestoreData]
    public class CameraIntrinsics
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }  // modelId or "{deviceId}_{mac}" for per-unit

        [FirestoreProperty]
        public string? ModelId { get; set; }

        [FirestoreProperty]
        public string? DeviceId { get; set; }  // null for model-level

        [FirestoreProperty]
        public string? CameraMac { get; set; }  // null for model-level

        [FirestoreProperty]
        public bool IsPerUnit { get; set; }

        [FirestoreProperty]
        public List<List<double>>? CameraMatrix { get; set; }

        [FirestoreProperty]
        public List<double>? DistortionCoefficients { get; set; }

        [FirestoreProperty]
        public double ReprojectionError { get; set; }

        [FirestoreProperty]
        public int SightingsUsed { get; set; }

        [FirestoreProperty]
        public double ComputedAtUnix { get; set; }
    }
}

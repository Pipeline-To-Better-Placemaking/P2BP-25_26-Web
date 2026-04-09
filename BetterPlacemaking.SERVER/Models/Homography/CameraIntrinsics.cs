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

        // Firestore does not support nested arrays; store 3x3 matrix flattened (9 elements).
        [FirestoreProperty]
        public List<double>? CameraMatrixFlat { get; set; }

        public List<List<double>>? CameraMatrix
        {
            get => CameraMatrixFlat is { Count: 9 }
                ? Enumerable.Range(0, 3).Select(i => CameraMatrixFlat.GetRange(i * 3, 3)).ToList()
                : null;
            set => CameraMatrixFlat = value?.SelectMany(r => r).ToList();
        }

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

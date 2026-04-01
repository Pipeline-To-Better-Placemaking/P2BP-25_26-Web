using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.Homography
{
    [FirestoreData]
    public class LocalHomography
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? DeviceId { get; set; }

        [FirestoreProperty]
        public string? CameraMac { get; set; }

        [FirestoreProperty]
        public List<List<double>>? Matrix { get; set; }  // 3x3 row-major

        [FirestoreProperty]
        public List<int>? FrameSize { get; set; }  // [width, height]

        [FirestoreProperty]
        public int Inliers { get; set; }

        [FirestoreProperty]
        public double RmseBoard { get; set; }

        [FirestoreProperty]
        public int CornersUsed { get; set; }

        [FirestoreProperty]
        public int MarkersDetected { get; set; }

        [FirestoreProperty]
        public string? ArucoDict { get; set; }

        [FirestoreProperty]
        public int SquaresX { get; set; }

        [FirestoreProperty]
        public int SquaresY { get; set; }

        [FirestoreProperty]
        public double SquareLength { get; set; }

        [FirestoreProperty]
        public double MarkerLength { get; set; }

        [FirestoreProperty]
        public double TimestampUnix { get; set; }

        [FirestoreProperty]
        public string? SnapshotPath { get; set; }

        [FirestoreProperty]
        public List<List<double>>? CameraMatrix { get; set; }  // 3x3

        [FirestoreProperty]
        public List<double>? DistortionCoefficients { get; set; }
    }
}

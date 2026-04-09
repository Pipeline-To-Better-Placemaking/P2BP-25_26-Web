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

        // Firestore does not support nested arrays, so we store the matrix flattened (9 elements)
        // and expose it as a 3x3 nested list for application use.
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

        // Same flattening strategy as Matrix above.
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
        public bool? UsedUndistortedImage { get; set; }
    }
}

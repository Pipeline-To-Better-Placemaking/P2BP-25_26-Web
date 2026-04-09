using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.Homography
{
    [FirestoreData]
    public sealed class PuzzlePieceArtifact
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? ProjectId { get; set; }

        [FirestoreProperty]
        public string? DeviceId { get; set; }

        [FirestoreProperty]
        public string? CameraMac { get; set; }

        [FirestoreProperty]
        public string? LocalHomographyId { get; set; }

        [FirestoreProperty]
        public string? LocalHomographyHash { get; set; }

        // Firestore does not support nested arrays; store 3x3 matrices flattened (9 elements).
        [FirestoreProperty]
        public List<double>? LocalHomographyMatrixFlat { get; set; }

        public List<List<double>>? LocalHomographyMatrix
        {
            get => LocalHomographyMatrixFlat is { Count: 9 }
                ? Enumerable.Range(0, 3).Select(i => LocalHomographyMatrixFlat.GetRange(i * 3, 3)).ToList()
                : null;
            set => LocalHomographyMatrixFlat = value?.SelectMany(r => r).ToList();
        }

        [FirestoreProperty]
        public List<double>? HLocalCanvasFlat { get; set; }

        public List<List<double>>? HLocalCanvas
        {
            get => HLocalCanvasFlat is { Count: 9 }
                ? Enumerable.Range(0, 3).Select(i => HLocalCanvasFlat.GetRange(i * 3, 3)).ToList()
                : null;
            set => HLocalCanvasFlat = value?.SelectMany(r => r).ToList();
        }

        [FirestoreProperty]
        public List<int>? SourceFrameSize { get; set; }

        [FirestoreProperty]
        public List<int>? PuzzlePieceSize { get; set; }

        [FirestoreProperty]
        public string? SourceSnapshotPath { get; set; }

        [FirestoreProperty]
        public string? PuzzlePiecePath { get; set; }

        [FirestoreProperty]
        public Timestamp GeneratedAt { get; set; }
    }
}

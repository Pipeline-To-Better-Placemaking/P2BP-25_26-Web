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

        [FirestoreProperty]
        public List<List<double>>? LocalHomographyMatrix { get; set; }

        [FirestoreProperty]
        public List<List<double>>? HLocalCanvas { get; set; }

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

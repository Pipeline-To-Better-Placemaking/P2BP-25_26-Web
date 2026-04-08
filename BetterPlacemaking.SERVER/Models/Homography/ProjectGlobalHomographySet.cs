using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.Homography
{
    [FirestoreData]
    public sealed class ProjectGlobalHomographySet
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? ProjectId { get; set; }

        [FirestoreProperty]
        public string? FloorplanId { get; set; }

        [FirestoreProperty]
        public double MmPerFpPx { get; set; }

        [FirestoreProperty]
        public List<double>? OriginFp { get; set; }

        [FirestoreProperty]
        public List<int>? FloorplanSize { get; set; }

        [FirestoreProperty]
        public List<GlobalHomographyPlacementRecord>? Placements { get; set; }

        [FirestoreProperty]
        public List<HomographyLockGroupRecord>? LockedGroups { get; set; }

        [FirestoreProperty]
        public string? SavedByUserId { get; set; }

        [FirestoreProperty]
        public Timestamp SavedAt { get; set; }
    }

    [FirestoreData]
    public sealed class GlobalHomographyPlacementRecord
    {
        [FirestoreProperty]
        public string? PuzzlePieceId { get; set; }

        [FirestoreProperty]
        public string? DeviceId { get; set; }

        [FirestoreProperty]
        public string? CameraMac { get; set; }

        [FirestoreProperty]
        public List<double>? CenterFp { get; set; }

        [FirestoreProperty]
        public double AngleDeg { get; set; }

        [FirestoreProperty]
        public double Scale { get; set; }

        [FirestoreProperty]
        public List<List<double>>? HLocalCanvas { get; set; }

        [FirestoreProperty]
        public List<int>? LocalCanvasSize { get; set; }

        [FirestoreProperty]
        public List<List<double>>? GlobalHomographyFloorplan { get; set; }

        [FirestoreProperty]
        public List<List<double>>? GlobalHomography { get; set; }
    }

    [FirestoreData]
    public sealed class HomographyLockGroupRecord
    {
        [FirestoreProperty]
        public string? GroupId { get; set; }

        [FirestoreProperty]
        public List<string>? CameraMacs { get; set; }
    }
}

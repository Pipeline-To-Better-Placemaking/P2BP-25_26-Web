using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.Homography
{
    [FirestoreData]
    public class ArUcoSighting
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? SessionId { get; set; }

        [FirestoreProperty]
        public string? DeviceId { get; set; }

        [FirestoreProperty]
        public string? CameraMac { get; set; }

        [FirestoreProperty]
        public string? ArucoDict { get; set; }

        [FirestoreProperty]
        public string? CapturedAt { get; set; }

        [FirestoreProperty]
        public List<ArUcoMarkerRecord>? Markers { get; set; }

        [FirestoreProperty]
        public string? LocalHomographyHash { get; set; }
    }

    [FirestoreData]
    public class ArUcoMarkerRecord
    {
        [FirestoreProperty]
        public int MarkerId { get; set; }

        [FirestoreProperty]
        public List<List<double>>? CornersPx { get; set; }
    }
}

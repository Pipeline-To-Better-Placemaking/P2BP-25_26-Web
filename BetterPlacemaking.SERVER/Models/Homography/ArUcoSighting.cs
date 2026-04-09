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

        // Firestore does not support nested arrays; flatten to [x0,y0, x1,y1, ...] and reconstruct on read.
        [FirestoreProperty]
        public List<double>? CornersPxFlat { get; set; }

        public List<List<double>>? CornersPx
        {
            get => CornersPxFlat is { Count: >= 2 } flat && flat.Count % 2 == 0
                ? Enumerable.Range(0, flat.Count / 2).Select(i => flat.GetRange(i * 2, 2)).ToList()
                : null;
            set => CornersPxFlat = value?.SelectMany(r => r).ToList();
        }
    }
}

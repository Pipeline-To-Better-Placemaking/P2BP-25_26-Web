using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.Homography
{
    [FirestoreData]
    public class ArUcoScanSession
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? ArucoDict { get; set; }

        /// <summary>
        /// collecting → computing → done | failed
        /// </summary>
        [FirestoreProperty]
        public string Status { get; set; } = "collecting";

        [FirestoreProperty]
        public List<string>? CamerasCheckedIn { get; set; }

        [FirestoreProperty]
        public int CamerasTotal { get; set; }

        [FirestoreProperty]
        public Timestamp CreatedAt { get; set; }
    }
}

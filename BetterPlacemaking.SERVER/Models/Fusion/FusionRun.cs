using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.Fusion
{
    [FirestoreData]
    public class FusionRun
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? Status { get; set; } // "running" | "success" | "failed"

        [FirestoreProperty]
        public string? TriggeredBy { get; set; } // "manual" | "scheduled"

        [FirestoreProperty]
        public double? FromDateUnix { get; set; }

        [FirestoreProperty]
        public double? ToDateUnix { get; set; }

        [FirestoreProperty]
        public double? StartedAtUnix { get; set; }

        [FirestoreProperty]
        public double? CompletedAtUnix { get; set; }

        [FirestoreProperty]
        public int? RecordsFused { get; set; }

        [FirestoreProperty]
        public string? ErrorMessage { get; set; }

        [FirestoreProperty]
        public string? OutputGcsPath { get; set; } // e.g. "vision/fused/fused_tracks-20250408.json"
    }
}

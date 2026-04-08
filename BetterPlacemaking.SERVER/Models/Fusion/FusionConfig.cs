using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.Fusion
{
    [FirestoreData]
    public class FusionConfig
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        /// <summary>Hour (0-23) in UTC at which the nightly fusion runs.</summary>
        [FirestoreProperty]
        public int ScheduledHourUtc { get; set; } = 21; // default 9 PM UTC

        /// <summary>Minute (0-59) of the scheduled hour.</summary>
        [FirestoreProperty]
        public int ScheduledMinuteUtc { get; set; } = 0;

        [FirestoreProperty]
        public bool Enabled { get; set; } = true;

        [FirestoreProperty]
        public double? UpdatedAtUnix { get; set; }
    }
}

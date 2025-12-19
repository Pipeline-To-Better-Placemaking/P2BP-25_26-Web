using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.JetsonDTOs
{
    [FirestoreData]
    public class Config
    {
        [FirestoreDocumentId]
        public string? DeviceId { get; set; }

        [FirestoreProperty]
        public TrackingConfig? Tracking { get; set; }

        [FirestoreProperty]
        public CameraConfig? Camera { get; set; }

        [FirestoreProperty]
        public int HeartbeatInterval { get; set; }

        [FirestoreProperty]
        public string? Version { get; set; }
    }

    [FirestoreData]
    public class TrackingConfig
    {
        [FirestoreProperty]
        public bool Enabled { get; set; }

        [FirestoreProperty]
        public string? Model { get; set; }

        [FirestoreProperty]
        public double ConfidenceThreshold { get; set; }

        [FirestoreProperty]
        public int MaxFps { get; set; }
    }

    [FirestoreData]
    public class CameraConfig
    {
        [FirestoreProperty]
        public string? Resolution { get; set; }

        [FirestoreProperty]
        public int Framerate { get; set; }

        [FirestoreProperty]
        public string? Codec { get; set; }
    }
}
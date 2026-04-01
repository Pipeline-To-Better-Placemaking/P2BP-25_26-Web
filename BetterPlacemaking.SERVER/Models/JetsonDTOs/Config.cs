using System.Collections.Generic;
using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.JetsonDTOs
{
    [FirestoreData]
    public class Config
    {
        [FirestoreProperty]
        public TrackingConfig? Tracking { get; set; }

        [FirestoreProperty]
        public CameraConfig? Camera { get; set; }

        [FirestoreProperty]
        public Dictionary<string, bool>? TrackingCameras { get; set; }

        [FirestoreProperty]
        public CharucoBoardConfig? CharucoBoard { get; set; }

        [FirestoreProperty]
        public ArucoLockConfig? ArucoLock { get; set; }

        [FirestoreProperty]
        public IntrinsicsConfig? Intrinsics { get; set; }

        [FirestoreProperty]
        public int HeartbeatInterval { get; set; }

        [FirestoreProperty]
        public string? Version { get; set; }

        public string? UploadLink { get; set; }
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

    [FirestoreData]
    public class CharucoBoardConfig
    {
        [FirestoreProperty]
        public CharucoBoardDetails? Board { get; set; }

        [FirestoreProperty]
        public bool BeginScanning { get; set; }

        [FirestoreProperty]
        public string? Status { get; set; }

        [FirestoreProperty]
        public double? LastRunUnix { get; set; }
    }

    [FirestoreData]
    public class CharucoBoardDetails
    {
        [FirestoreProperty]
        public int SquaresX { get; set; }

        [FirestoreProperty]
        public int SquaresY { get; set; }

        [FirestoreProperty]
        public double SquareSize { get; set; }

        [FirestoreProperty]
        public double ArucoSize { get; set; }

        [FirestoreProperty]
        public string? Dictionary { get; set; }
    }

    [FirestoreData]
    public class IntrinsicsConfig
    {
        [FirestoreProperty]
        public bool BeginCalibration { get; set; }

        [FirestoreProperty]
        public string? ModelId { get; set; }

        [FirestoreProperty]
        public List<string>? PerUnitOverrideMacs { get; set; }

        [FirestoreProperty]
        public int MinSightings { get; set; } = 40;

        [FirestoreProperty]
        public int GridCells { get; set; } = 9;
    }

    [FirestoreData]
    public class ArucoLockConfig
    {
        [FirestoreProperty]
        public bool BeginScanning { get; set; }

        [FirestoreProperty]
        public string ArucoDict { get; set; } = "DICT_4X4_50";

        [FirestoreProperty]
        public int MinFrames { get; set; } = 10;

        [FirestoreProperty]
        public double MaxSecondsPerCam { get; set; } = 10.0;

        [FirestoreProperty]
        public string? Status { get; set; }

        [FirestoreProperty]
        public double? LastRunUnix { get; set; }
    }
}

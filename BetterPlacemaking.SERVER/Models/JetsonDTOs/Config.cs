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

    [FirestoreData]
    public class CharucoBoardConfig
    {
        [FirestoreProperty]
        public CharucoReferencePoints? ReferencePoints { get; set; }

        [FirestoreProperty]
        public CharucoBoardDetails? Board { get; set; }

        [FirestoreProperty]
        public bool BeginScanning { get; set; }
    }

    [FirestoreData]
    public class CharucoReferencePoints
    {
        [FirestoreProperty]
        public CharucoPoint? P1 { get; set; }

        [FirestoreProperty]
        public CharucoPoint? P2 { get; set; }
    }

    [FirestoreData]
    public class CharucoPoint
    {
        [FirestoreProperty("x")]
        public int X { get; set; }

        [FirestoreProperty("y")]
        public int Y { get; set; }
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
}
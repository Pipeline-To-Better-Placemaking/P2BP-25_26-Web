using System.Collections.Generic;
using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.JetsonDTOs
{
    [FirestoreData]
    public class HealthReport
    {
        [FirestoreProperty]
        public long Timestamp { get; set; }

        [FirestoreProperty]
        public Dictionary<string, ServiceStatus>? Services { get; set; }

        [FirestoreProperty]
        public Dictionary<string, CameraInfo>? Cameras { get; set; }

        [FirestoreProperty]
        public SystemInfo? System { get; set; }

        [FirestoreProperty]
        public Dictionary<string, IntrinsicsCalibrationState>? IntrinsicsCalibration { get; set; }

        [FirestoreProperty]
        public Dictionary<string, LidarHealthInfo>? Lidars { get; set; }

        [FirestoreProperty]
        public PiCompanionHealthInfo? PiCompanion { get; set; }
    }

    [FirestoreData]
    public class LidarHealthInfo
    {
        [FirestoreProperty]
        public string? SensorId { get; set; }

        [FirestoreProperty]
        public bool Connected { get; set; }

        [FirestoreProperty]
        public string? DevicePath { get; set; }

        [FirestoreProperty]
        public string? UsbHint { get; set; }

        [FirestoreProperty]
        public string? LastError { get; set; }
    }

    [FirestoreData]
    public class PiCompanionHealthInfo
    {
        [FirestoreProperty]
        public bool Configured { get; set; }

        [FirestoreProperty]
        public string? Host { get; set; }

        [FirestoreProperty]
        public bool Reachable { get; set; }

        [FirestoreProperty]
        public int LatencyMs { get; set; }

        [FirestoreProperty]
        public string? LastError { get; set; }
    }

    [FirestoreData]
    public class IntrinsicsCalibrationState
    {
        [FirestoreProperty]
        public string? Status { get; set; }  // "collecting" | "computing" | "done" | "failed"

        [FirestoreProperty]
        public int SightingsCollected { get; set; }

        [FirestoreProperty]
        public List<int>? CoverageGrid { get; set; }  // flat list of 0/1 per cell

        [FirestoreProperty]
        public string? SuggestedRegion { get; set; }  // e.g. "top-left", null when all covered

        [FirestoreProperty]
        public string? SuggestedTilt { get; set; }

        [FirestoreProperty]
        public double CurrentRmse { get; set; }
    }

    [FirestoreData]
    public class CameraInfo
    {
        [FirestoreProperty]
        public string? Mac { get; set; }

        [FirestoreProperty]
        public string? Ip { get; set; }

        [FirestoreProperty]
        public List<int>? Resolution { get; set; }

        [FirestoreProperty]
        public bool Enabled { get; set; }
    }

    [FirestoreData]
    public class ServiceStatus
    {
        [FirestoreProperty]
        public string? Active { get; set; }

        [FirestoreProperty]
        public string? Sub { get; set; }
    }

    [FirestoreData]
    public class SystemInfo
    {
        [FirestoreProperty]
        public GpuInfo? Gpu { get; set; }

        [FirestoreProperty]
        public MemoryInfo? Memory { get; set; }

        [FirestoreProperty]
        public List<DiskPartitionInfo>? Disk { get; set; }

        [FirestoreProperty]
        public double CpuTemperatureC { get; set; }
    }

    [FirestoreData]
    public class DiskPartitionInfo
    {
        [FirestoreProperty]
        public string? Path { get; set; }

        [FirestoreProperty]
        public int TotalMb { get; set; }

        [FirestoreProperty]
        public int UsedMb { get; set; }

        [FirestoreProperty]
        public int FreeMb { get; set; }

        [FirestoreProperty]
        public int UsePct { get; set; }

        [FirestoreProperty]
        public string? Status { get; set; }  // "ok" | "warning" | "critical"

        [FirestoreProperty]
        public int DeletedFiles { get; set; }
    }

    [FirestoreData]
    public class GpuInfo
    {
        [FirestoreProperty]
        public int UtilizationPct { get; set; }

        [FirestoreProperty]
        public int FrequencyMhz { get; set; }

        [FirestoreProperty]
        public double TemperatureC { get; set; }
    }

    [FirestoreData]
    public class MemoryInfo
    {
        [FirestoreProperty]
        public int UsedMb { get; set; }

        [FirestoreProperty]
        public int TotalMb { get; set; }
    }
}

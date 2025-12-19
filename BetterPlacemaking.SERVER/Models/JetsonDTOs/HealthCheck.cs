using System.Collections.Generic;
using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models.JetsonDTOs
{
    [FirestoreData]
    public class HealthCheck
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? DeviceId { get; set; }

        [FirestoreProperty]
        public string? ProjectId { get; set; }

        [FirestoreProperty]
        public long Timestamp { get; set; }

        [FirestoreProperty]
        public Dictionary<string, ServiceStatus>? Services { get; set; }

        [FirestoreProperty]
        public SystemInfo? System { get; set; }
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
    }

    [FirestoreData]
    public class GpuInfo
    {
        [FirestoreProperty]
        public int UtilizationPct { get; set; }

        [FirestoreProperty]
        public int FrequencyMhz { get; set; }
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
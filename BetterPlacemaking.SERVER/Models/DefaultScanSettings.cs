namespace BetterPlacemaking.Models
{
    // Server-side defaults for scans that are fired without an explicit settings payload
    // (e.g. from ScanScheduleExecutorService). Values mirror BASE_SCAN_SETTINGS in
    // BetterPlacemaking.CLIENT/src/app/services/scan-service.ts.
    public static class DefaultScanSettings
    {
        public static ScanSettingsRequest ForScheduledRun() => new()
        {
            scan_resolution = 8,
            protocol_mode = "legacy",
            orientation_mode = "table",
            output_mode = "filtered_only",
            split_mode = "none",
            filter_enabled = false,
            capture_strategy = "hybrid",
            min_revolutions_per_slice = 1,
            force_recalibration = false,
        };
    }
}

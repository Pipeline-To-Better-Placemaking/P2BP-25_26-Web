using System;

namespace BetterPlacemaking.Models
{
    public class ScanSettingsRequest
    {
        public int scan_resolution { get; set; }
        public string? protocol_mode { get; set; }
        public string? orientation_mode { get; set; }
        public string? output_mode { get; set; }
        public string? split_mode { get; set; }
        public bool filter_enabled { get; set; }
        public string? capture_strategy { get; set; }
        public int min_revolutions_per_slice { get; set; }
        public bool force_recalibration { get; set; }

        // Mirror of the frontend ScanSettingsPayload enum/numeric domains in
        // BetterPlacemaking.CLIENT/src/app/services/scan-service.ts.
        public static readonly int[] AllowedScanResolutions = { 1, 8, 16, 32, 64 };
        public static readonly string[] AllowedProtocolModes = { "legacy", "express", "dense", "ultra" };
        public static readonly string[] AllowedOrientationModes = { "table", "ceiling", "wall", "custom" };
        public static readonly string[] AllowedOutputModes = { "filtered_only", "raw_only", "raw_and_filtered" };
        public static readonly string[] AllowedSplitModes = { "none", "front_back_180" };
        public static readonly string[] AllowedCaptureStrategies = { "fixed_time", "min_revolutions", "hybrid" };
        public static readonly int[] AllowedMinRevolutionsPerSlice = { 1, 2, 3 };

        /// <summary>Returns null if valid; a short human-readable message otherwise.</summary>
        public string? Validate()
        {
            if (Array.IndexOf(AllowedScanResolutions, scan_resolution) < 0)
                return $"scan_resolution must be one of {string.Join(", ", AllowedScanResolutions)}";
            if (protocol_mode is null || Array.IndexOf(AllowedProtocolModes, protocol_mode) < 0)
                return $"protocol_mode must be one of {string.Join(", ", AllowedProtocolModes)}";
            if (orientation_mode is null || Array.IndexOf(AllowedOrientationModes, orientation_mode) < 0)
                return $"orientation_mode must be one of {string.Join(", ", AllowedOrientationModes)}";
            if (output_mode is null || Array.IndexOf(AllowedOutputModes, output_mode) < 0)
                return $"output_mode must be one of {string.Join(", ", AllowedOutputModes)}";
            if (split_mode is null || Array.IndexOf(AllowedSplitModes, split_mode) < 0)
                return $"split_mode must be one of {string.Join(", ", AllowedSplitModes)}";
            if (capture_strategy is null || Array.IndexOf(AllowedCaptureStrategies, capture_strategy) < 0)
                return $"capture_strategy must be one of {string.Join(", ", AllowedCaptureStrategies)}";
            if (Array.IndexOf(AllowedMinRevolutionsPerSlice, min_revolutions_per_slice) < 0)
                return $"min_revolutions_per_slice must be one of {string.Join(", ", AllowedMinRevolutionsPerSlice)}";
            return null;
        }
    }
}

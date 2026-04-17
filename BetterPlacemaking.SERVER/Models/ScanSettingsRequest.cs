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
    }
}
namespace BetterPlacemaking.Models.Dtos.Fusion
{
    public record FusionRunDto(
        string Id,
        string Status,
        string TriggeredBy,
        double? FromDateUnix,
        double? ToDateUnix,
        double? StartedAtUnix,
        double? CompletedAtUnix,
        int? RecordsFused,
        string? ErrorMessage,
        string? OutputGcsPath
    );

    public record FusionConfigDto(
        int ScheduledHourUtc,
        int ScheduledMinuteUtc,
        bool Enabled
    );

    public record TriggerFusionDto(
        double FromDateUnix,
        double ToDateUnix
    );

    public record UpdateFusionConfigDto(
        int ScheduledHourUtc,
        int ScheduledMinuteUtc,
        bool Enabled
    );
}

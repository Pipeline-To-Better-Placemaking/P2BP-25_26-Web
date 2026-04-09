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
        string? OutputGcsPath = null,
        string? ProjectId = null
    );

    public record FusionConfigDto(
        int ScheduledHourUtc,
        int ScheduledMinuteUtc,
        bool Enabled,
        string? ProjectId = null
    );

    public record TriggerFusionDto(
        double FromDateUnix,
        double ToDateUnix,
        string? ProjectId = null
    );

    public record UpdateFusionConfigDto(
        int ScheduledHourUtc,
        int ScheduledMinuteUtc,
        bool Enabled,
        string? ProjectId = null
    );
}

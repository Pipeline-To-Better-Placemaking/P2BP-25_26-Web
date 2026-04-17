namespace BetterPlacemaking.Services;

public sealed record ScanIngestAttemptResult(bool Loaded, string? Reason, string? Message = null)
{
    public static ScanIngestAttemptResult Ok() => new(true, null, null);

    public static ScanIngestAttemptResult Fail(string reason, string? message = null) =>
        new(false, reason, message);
}

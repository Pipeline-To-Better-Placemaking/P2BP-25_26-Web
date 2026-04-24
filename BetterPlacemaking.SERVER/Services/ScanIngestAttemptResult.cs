namespace BetterPlacemaking.Services;

public sealed record ScanIngestAttemptResult(bool Loaded, string? Reason, string? Message = null)
{
    public static ScanIngestAttemptResult Ok() => new(true, null, null);
    public static ScanIngestAttemptResult AlreadyCurrent(string? message = null) =>
        new(true, "already_current", message);

    public static ScanIngestAttemptResult Fail(string reason, string? message = null) =>
        new(false, reason, message);
}

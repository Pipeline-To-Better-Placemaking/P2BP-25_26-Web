using BetterPlacemaking.Controllers;
using BetterPlacemaking.Services.Visualizer;
using Microsoft.Extensions.Options;

namespace BetterPlacemaking.Services;

/// <summary>
/// When a device scan completes with <c>ObjUrl</c> pointing at a downloadable <c>.xyz</c> file,
/// fetches it (SSRF-restricted) and replaces the in-memory visualizer session.
/// </summary>
public sealed class ScanCompleteVisualizerIngestService
{
    public const string HttpClientName = "ScanCompleteIngest";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly XyzParserService _xyzParser;
    private readonly FastMeshService _fastMesh;
    private readonly ILogger<ScanCompleteVisualizerIngestService> _logger;
    private readonly ScanIngestOptions _options;

    public ScanCompleteVisualizerIngestService(
        IHttpClientFactory httpClientFactory,
        XyzParserService xyzParser,
        FastMeshService fastMesh,
        IOptions<ScanIngestOptions> options,
        ILogger<ScanCompleteVisualizerIngestService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _xyzParser = xyzParser;
        _fastMesh = fastMesh;
        _logger = logger;
        _options = options.Value;
    }

    /// <summary>
    /// Ingest if Firestore scan is <c>complete</c> and has a non-empty <c>ObjUrl</c>.
    /// </summary>
    public async Task TryIngestFromScanDocumentAsync(
        Dictionary<string, object>? scan,
        CancellationToken cancellationToken = default)
    {
        if (scan == null || scan.Count == 0)
            return;

        var status = GetStringField(scan, "Status");
        var objUrl = GetStringField(scan, "ObjUrl");
        await TryIngestAsync(status, objUrl, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Download <paramref name="objUrl"/> when <paramref name="status"/> is <c>complete</c>.
    /// </summary>
    public async Task TryIngestAsync(
        string? status,
        string? objUrl,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(status)
            || !string.Equals(status.Trim(), "complete", StringComparison.OrdinalIgnoreCase))
            return;

        if (string.IsNullOrWhiteSpace(objUrl))
            return;

        if (!Uri.TryCreate(objUrl.Trim(), UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps)
        {
            _logger.LogWarning("Scan ingest skipped: ObjUrl must be an absolute https URL.");
            return;
        }

        if (!IsHostAllowed(uri.Host))
        {
            _logger.LogWarning("Scan ingest skipped: host {Host} is not in the allowlist.", uri.Host);
            return;
        }

        var maxBytes = _options.MaxDownloadBytes > 0 ? _options.MaxDownloadBytes : 200L * 1024 * 1024;
        var units = string.IsNullOrWhiteSpace(_options.XyzUnits) ? "m" : _options.XyzUnits!;

        var client = _httpClientFactory.CreateClient(HttpClientName);
        string? tempPath = null;
        try
        {
            using var response = await client
                .GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
                .ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Scan ingest HTTP {Status} for ObjUrl host {Host}.",
                    (int)response.StatusCode,
                    uri.Host);
                return;
            }

            var contentLength = response.Content.Headers.ContentLength;
            if (contentLength.HasValue && contentLength.Value > maxBytes)
            {
                _logger.LogWarning("Scan ingest skipped: Content-Length {Len} exceeds max {Max}.", contentLength.Value, maxBytes);
                return;
            }

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            tempPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"scan_xyz_{Guid.NewGuid():N}.xyz");
            await using (var file = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                var buffer = new byte[65536];
                long total = 0;
                int read;
                while ((read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false)) > 0)
                {
                    total += read;
                    if (total > maxBytes)
                    {
                        _logger.LogWarning("Scan ingest aborted: download exceeded max {Max} bytes.", maxBytes);
                        return;
                    }

                    await file.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                }
            }

            var points = _xyzParser.ParseXyzFile(tempPath, sensorId: "device-scan", units: units);
            if (points.Count == 0)
            {
                _logger.LogWarning("Scan ingest: no valid points parsed from downloaded .xyz.");
                return;
            }

            VisualizerController.ReplaceCurrentPointsFromIngest(points, _fastMesh);
            _logger.LogInformation("Scan ingest loaded {Count} points (revision bumped).", points.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Scan ingest failed for ObjUrl host {Host}.", uri.Host);
        }
        finally
        {
            if (tempPath != null)
            {
                try
                {
                    if (File.Exists(tempPath))
                        File.Delete(tempPath);
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Failed to delete temp ingest file.");
                }
            }
        }
    }

    private bool IsHostAllowed(string host)
    {
        var h = host.Trim().TrimEnd('.');
        foreach (var allowed in _options.AllowedHosts)
        {
            if (string.IsNullOrWhiteSpace(allowed))
                continue;
            var a = allowed.Trim().TrimEnd('.');
            if (string.Equals(h, a, StringComparison.OrdinalIgnoreCase))
                return true;
            if (h.EndsWith("." + a, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    private static string? GetStringField(Dictionary<string, object> scan, string key)
    {
        foreach (var k in new[] { key, char.ToLowerInvariant(key[0]) + key[1..] })
        {
            if (scan.TryGetValue(k, out var v) && v != null)
            {
                if (v is string s)
                    return s;
                return v.ToString();
            }
        }

        return null;
    }

}

public sealed class ScanIngestOptions
{
    public const string SectionName = "Visualizer:ScanIngest";

    /// <summary>Extra hostnames allowed for ObjUrl (besides defaults). Example: mybucket.storage.googleapis.com</summary>
    public string[] AllowedHosts { get; set; } = [];

    /// <summary>Passed to <see cref="XyzParserService.ParseXyzFile"/> (RPLidar exports are usually meters).</summary>
    public string XyzUnits { get; set; } = "m";

    public long MaxDownloadBytes { get; set; } = 200L * 1024 * 1024;
}

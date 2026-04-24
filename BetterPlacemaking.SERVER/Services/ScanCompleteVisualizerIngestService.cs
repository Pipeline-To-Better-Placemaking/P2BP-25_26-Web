using System.Net;
using BetterPlacemaking.Controllers;
using BetterPlacemaking.Services.Visualizer;
using Google;
using Microsoft.Extensions.Options;

namespace BetterPlacemaking.Services;

/// <summary>
/// Ingests device scan .xyz from HTTPS ObjUrl (SSRF-restricted) or canonical GCS path used by the lidar pipeline.
/// </summary>
public sealed class ScanCompleteVisualizerIngestService
{
    public const string HttpClientName = "ScanCompleteIngest";

    public static string CanonicalLidarXyzObjectName(string projectId, string deviceId, string scanId) =>
        $"vision/lidar-scans/{projectId.Trim().Trim('/')}/{deviceId.Trim().Trim('/')}/{scanId.Trim().Trim('/')}.xyz";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly XyzParserService _xyzParser;
    private readonly FastMeshService _fastMesh;
    private readonly CloudStorageService _cloudStorage;
    private readonly ILogger<ScanCompleteVisualizerIngestService> _logger;
    private readonly ScanIngestOptions _options;
    private readonly object _latestIngestLock = new();
    private string? _latestIngestKey;
    private long _latestIngestRevision = -1;

    public ScanCompleteVisualizerIngestService(
        IHttpClientFactory httpClientFactory,
        XyzParserService xyzParser,
        FastMeshService fastMesh,
        CloudStorageService cloudStorage,
        IOptions<ScanIngestOptions> options,
        ILogger<ScanCompleteVisualizerIngestService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _xyzParser = xyzParser;
        _fastMesh = fastMesh;
        _cloudStorage = cloudStorage;
        _logger = logger;
        _options = options.Value;
    }

    public async Task TryIngestFromScanDocumentAsync(
        Dictionary<string, object>? scan,
        CancellationToken cancellationToken = default)
    {
        if (scan == null || scan.Count == 0)
            return;

        var status = GetStringField(scan, "Status");
        var objUrl = GetStringField(scan, "ObjUrl");
        await TryIngestFromHttpsObjUrlAsync(status, objUrl, cancellationToken).ConfigureAwait(false);
    }

    public Task TryIngestAsync(
        string? status,
        string? objUrl,
        CancellationToken cancellationToken = default) =>
        TryIngestFromHttpsObjUrlAsync(status, objUrl, cancellationToken);

    /// <summary>
    /// Returns the raw .xyz bytes for a scan. Prefers Firestore ObjUrl (HTTPS + host allowlist + size cap),
    /// then falls back to the canonical GCS object at <see cref="CanonicalLidarXyzObjectName"/>.
    /// Returns null when neither source resolves. Caller owns the returned stream.
    /// </summary>
    public async Task<MemoryStream?> DownloadScanXyzAsync(
        string projectId,
        string deviceId,
        Dictionary<string, object>? scan,
        CancellationToken cancellationToken = default)
    {
        if (scan == null || string.IsNullOrWhiteSpace(projectId) || string.IsNullOrWhiteSpace(deviceId))
            return null;

        var scanId = GetStringField(scan, "Id");
        if (string.IsNullOrWhiteSpace(scanId))
            return null;

        var objUrl = GetStringField(scan, "ObjUrl");
        var fromUrl = await TryDownloadXyzFromObjUrlAsync(objUrl, cancellationToken).ConfigureAwait(false);
        if (fromUrl != null)
            return fromUrl;

        var objectName = CanonicalLidarXyzObjectName(projectId, deviceId, scanId);
        var maxBytes = _options.MaxDownloadBytes > 0 ? _options.MaxDownloadBytes : 200L * 1024 * 1024;

        var ms = new MemoryStream();
        try
        {
            await _cloudStorage.DownloadToStreamAsync(objectName, ms, cancellationToken).ConfigureAwait(false);
            if (ms.Length > maxBytes)
            {
                _logger.LogWarning("Scan xyz: GCS object {Object} exceeded size cap.", objectName);
                await ms.DisposeAsync().ConfigureAwait(false);
                return null;
            }
            ms.Position = 0;
            return ms;
        }
        catch (GoogleApiException ex) when (ex.HttpStatusCode == HttpStatusCode.NotFound)
        {
            _logger.LogWarning(ex, "Scan xyz: canonical GCS object not found {Object}.", objectName);
            await ms.DisposeAsync().ConfigureAwait(false);
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Scan xyz: GCS fallback failed for {Object}.", objectName);
            await ms.DisposeAsync().ConfigureAwait(false);
            return null;
        }
    }

    private async Task<MemoryStream?> TryDownloadXyzFromObjUrlAsync(string? objUrl, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(objUrl))
            return null;

        if (!Uri.TryCreate(objUrl.Trim(), UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
        {
            _logger.LogWarning("Scan xyz download skipped: ObjUrl must be an absolute https URL.");
            return null;
        }

        if (!IsHostAllowed(uri.Host))
        {
            _logger.LogWarning("Scan xyz download skipped: host {Host} not allowlisted.", uri.Host);
            return null;
        }

        var maxBytes = _options.MaxDownloadBytes > 0 ? _options.MaxDownloadBytes : 200L * 1024 * 1024;
        var client = _httpClientFactory.CreateClient(HttpClientName);

        var ms = new MemoryStream();
        try
        {
            using var response = await client
                .GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
                .ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                await ms.DisposeAsync().ConfigureAwait(false);
                return null;
            }

            var contentLength = response.Content.Headers.ContentLength;
            if (contentLength.HasValue && contentLength.Value > maxBytes)
            {
                await ms.DisposeAsync().ConfigureAwait(false);
                return null;
            }

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            var buffer = new byte[65536];
            long total = 0;
            int read;
            while ((read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false)) > 0)
            {
                total += read;
                if (total > maxBytes)
                {
                    await ms.DisposeAsync().ConfigureAwait(false);
                    return null;
                }
                await ms.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
            }
            ms.Position = 0;
            return ms;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Scan xyz download failed for ObjUrl host {Host}.", uri.Host);
            await ms.DisposeAsync().ConfigureAwait(false);
            return null;
        }
    }

    public async Task<ScanIngestAttemptResult> TryIngestCompleteScanForVisualizerAsync(
        string projectId,
        string deviceId,
        Dictionary<string, object> scan,
        CancellationToken cancellationToken = default)
    {
        var status = GetStringField(scan, "Status");
        if (string.IsNullOrWhiteSpace(status)
            || !string.Equals(status.Trim(), "complete", StringComparison.OrdinalIgnoreCase))
            return ScanIngestAttemptResult.Fail("not_complete", "Scan is not marked complete in Firestore.");

        var scanId = GetStringField(scan, "Id");
        if (string.IsNullOrWhiteSpace(scanId))
            return ScanIngestAttemptResult.Fail("no_scan_id", "Scan document has no Id.");

        // Fast path: if this exact scan was already ingested and the visualizer session
        // revision has not changed since, skip re-download/re-parse/re-mesh.
        var ingestKey = $"{projectId.Trim()}/{deviceId.Trim()}/{scanId.Trim()}";
        var (_, currentRevision) = VisualizerController.GetSessionMetaSnapshot();
        lock (_latestIngestLock)
        {
            if (string.Equals(_latestIngestKey, ingestKey, StringComparison.Ordinal)
                && _latestIngestRevision == currentRevision)
            {
                return ScanIngestAttemptResult.AlreadyCurrent("Latest auto-uploaded scan already loaded.");
            }
        }

        var objUrl = GetStringField(scan, "ObjUrl");
        if (await TryIngestFromHttpsObjUrlAsync(status, objUrl, cancellationToken).ConfigureAwait(false))
        {
            var (_, revisionAfterIngest) = VisualizerController.GetSessionMetaSnapshot();
            lock (_latestIngestLock)
            {
                _latestIngestKey = ingestKey;
                _latestIngestRevision = revisionAfterIngest;
            }
            return ScanIngestAttemptResult.Ok();
        }

        var canonicalObjectName = CanonicalLidarXyzObjectName(projectId, deviceId, scanId);
        _logger.LogInformation(
            "Scan ingest: attempting GCS canonical object {Object} for scan {ScanId}.",
            canonicalObjectName,
            scanId);

        // 1) Try the canonical path first.
        var canonicalAttempt = await DownloadAndIngestGcsObjectAsync(
            canonicalObjectName,
            ingestKey,
            cancellationToken).ConfigureAwait(false);
        if (canonicalAttempt.Loaded || canonicalAttempt.Reason != "xyz_not_found")
            return canonicalAttempt;

        // 2) Canonical 404. Scan didn't land at the expected path — list the device folder
        //    and try (a) a file whose name starts with the scan id, (b) the newest .xyz,
        //    then fall back to the project-wide folder.
        var deviceFolder = $"vision/lidar-scans/{projectId.Trim().Trim('/')}/{deviceId.Trim().Trim('/')}";
        var projectFolder = $"vision/lidar-scans/{projectId.Trim().Trim('/')}";

        var fallbackMatch = await FindMatchingXyzInFolderAsync(deviceFolder, scanId, cancellationToken)
            .ConfigureAwait(false);
        if (fallbackMatch == null)
        {
            fallbackMatch = await FindMatchingXyzInFolderAsync(projectFolder, scanId, cancellationToken)
                .ConfigureAwait(false);
        }

        if (fallbackMatch != null)
        {
            _logger.LogInformation(
                "Scan ingest: canonical {Canonical} missing; attempting fallback GCS object {Fallback}.",
                canonicalObjectName,
                fallbackMatch);
            var fallbackAttempt = await DownloadAndIngestGcsObjectAsync(
                fallbackMatch,
                ingestKey,
                cancellationToken).ConfigureAwait(false);
            if (fallbackAttempt.Loaded)
            {
                return fallbackAttempt with
                {
                    Message = $"Loaded scan from GCS fallback path {fallbackMatch} (canonical {canonicalObjectName} was missing).",
                };
            }
            return fallbackAttempt;
        }

        _logger.LogWarning(
            "Scan ingest: no .xyz found under {DeviceFolder} or {ProjectFolder} (canonical was {Canonical}).",
            deviceFolder,
            projectFolder,
            canonicalObjectName);

        return ScanIngestAttemptResult.Fail(
            "xyz_not_found",
            $"No reachable .xyz for scan {scanId}. Canonical path '{canonicalObjectName}' is missing and no matching .xyz was found under '{deviceFolder}/' or '{projectFolder}/'.");
    }

    /// <summary>
    /// Downloads a single GCS object, parses it as XYZ, and replaces the session point cloud.
    /// Returns <c>xyz_not_found</c> specifically when the object does not exist (HTTP 404) so
    /// callers can probe alternate paths.
    /// </summary>
    private async Task<ScanIngestAttemptResult> DownloadAndIngestGcsObjectAsync(
        string objectName,
        string ingestKey,
        CancellationToken cancellationToken)
    {
        var maxBytes = _options.MaxDownloadBytes > 0 ? _options.MaxDownloadBytes : 200L * 1024 * 1024;
        var units = string.IsNullOrWhiteSpace(_options.XyzUnits) ? "m" : _options.XyzUnits!;
        string? tempPath = null;

        try
        {
            tempPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"gcs_scan_xyz_{Guid.NewGuid():N}.xyz");
            await using (var file = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                await _cloudStorage.DownloadToStreamAsync(objectName, file, cancellationToken).ConfigureAwait(false);
            }

            if (new FileInfo(tempPath).Length > maxBytes)
                return ScanIngestAttemptResult.Fail("file_too_large", $"Downloaded object {objectName} exceeds configured max size.");

            var points = _xyzParser.ParseXyzFile(tempPath, sensorId: "device-scan", units: units);
            if (points.Count == 0)
                return ScanIngestAttemptResult.Fail("no_points_parsed", $"No valid points in GCS object {objectName}.");

            VisualizerController.ReplaceCurrentPointsFromIngest(points, _fastMesh);
            _logger.LogInformation(
                "Scan ingest from GCS {Object} loaded {Count} points (revision bumped).",
                objectName,
                points.Count);
            var (_, revisionAfterIngest) = VisualizerController.GetSessionMetaSnapshot();
            lock (_latestIngestLock)
            {
                _latestIngestKey = ingestKey;
                _latestIngestRevision = revisionAfterIngest;
            }
            return ScanIngestAttemptResult.Ok();
        }
        catch (GoogleApiException ex) when (ex.HttpStatusCode == HttpStatusCode.NotFound)
        {
            _logger.LogWarning("GCS object not found: {Object}.", objectName);
            return ScanIngestAttemptResult.Fail(
                "xyz_not_found",
                $"GCS object {objectName} does not exist.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GCS ingest failed for {Object}.", objectName);
            return ScanIngestAttemptResult.Fail("ingest_error", $"Ingest of {objectName} failed; see server logs.");
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
                    _logger.LogDebug(ex, "Failed to delete temp GCS ingest file.");
                }
            }
        }
    }

    /// <summary>
    /// Looks for an <c>.xyz</c> file under <paramref name="folder"/> whose basename begins with
    /// <paramref name="scanId"/>. If no id-match is found, returns the newest <c>.xyz</c> in the
    /// folder. Returns <c>null</c> when the folder contains no <c>.xyz</c> objects.
    /// </summary>
    private async Task<string?> FindMatchingXyzInFolderAsync(
        string folder,
        string scanId,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<GcsFileInfo> files;
        try
        {
            files = await _cloudStorage.ListFilesAsync(folder, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Scan ingest: failed to list GCS folder {Folder}.", folder);
            return null;
        }

        var xyzFiles = files
            .Where(f => f.StoragePath.EndsWith(".xyz", StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (xyzFiles.Count == 0)
        {
            _logger.LogInformation("Scan ingest: no .xyz files under {Folder}.", folder);
            return null;
        }

        _logger.LogInformation(
            "Scan ingest: {Count} .xyz file(s) under {Folder}; newest first: {Names}.",
            xyzFiles.Count,
            folder,
            string.Join(", ", xyzFiles
                .OrderByDescending(f => f.LastModified)
                .Take(5)
                .Select(f => f.StoragePath)));

        // Prefer an exact scanId match (basename starts with the id).
        var idTrim = scanId.Trim();
        var idMatch = xyzFiles.FirstOrDefault(f =>
        {
            var baseName = System.IO.Path.GetFileNameWithoutExtension(f.StoragePath);
            return string.Equals(baseName, idTrim, StringComparison.OrdinalIgnoreCase)
                || baseName.StartsWith(idTrim, StringComparison.OrdinalIgnoreCase);
        });
        if (idMatch != null)
            return idMatch.StoragePath;

        // Otherwise return the most recently modified .xyz under the folder.
        return xyzFiles
            .OrderByDescending(f => f.LastModified)
            .First()
            .StoragePath;
    }

    private async Task<bool> TryIngestFromHttpsObjUrlAsync(
        string? status,
        string? objUrl,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(status)
            || !string.Equals(status.Trim(), "complete", StringComparison.OrdinalIgnoreCase))
            return false;

        if (string.IsNullOrWhiteSpace(objUrl))
            return false;

        if (!Uri.TryCreate(objUrl.Trim(), UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps)
        {
            _logger.LogWarning("Scan ingest skipped: ObjUrl must be an absolute https URL.");
            return false;
        }

        if (!IsHostAllowed(uri.Host))
        {
            _logger.LogWarning("Scan ingest skipped: host {Host} is not in the allowlist.", uri.Host);
            return false;
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
                return false;
            }

            var contentLength = response.Content.Headers.ContentLength;
            if (contentLength.HasValue && contentLength.Value > maxBytes)
            {
                _logger.LogWarning("Scan ingest skipped: Content-Length {Len} exceeds max {Max}.", contentLength.Value, maxBytes);
                return false;
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
                        return false;
                    }

                    await file.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                }
            }

            var points = _xyzParser.ParseXyzFile(tempPath, sensorId: "device-scan", units: units);
            if (points.Count == 0)
            {
                _logger.LogWarning("Scan ingest: no valid points parsed from downloaded .xyz.");
                return false;
            }

            VisualizerController.ReplaceCurrentPointsFromIngest(points, _fastMesh);
            _logger.LogInformation("Scan ingest loaded {Count} points (revision bumped).", points.Count);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Scan ingest failed for ObjUrl host {Host}.", uri.Host);
            return false;
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

    public string[] AllowedHosts { get; set; } = [];

    public string XyzUnits { get; set; } = "m";

    public long MaxDownloadBytes { get; set; } = 200L * 1024 * 1024;
}

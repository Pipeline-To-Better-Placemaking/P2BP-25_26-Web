using BetterPlacemaking.Models.Dtos.Fusion;
using BetterPlacemaking.Models.Fusion;
using Google.Cloud.Firestore;
using Microsoft.Extensions.Logging;
using BetterPlacemaking.Models.Dtos;

namespace BetterPlacemaking.Services
{
    public class FusionService(
        FirestoreDb db,
        ILogger<FusionService> logger,
        CloudStorageService gcs,
        FusionCancellationRegistry cancelRegistry)
    {
        private readonly FirestoreDb                 _db             = db;
        private readonly ILogger<FusionService>      _logger         = logger;
        private readonly CloudStorageService         _gcs            = gcs;
        private readonly FusionCancellationRegistry  _cancelRegistry = cancelRegistry;

        private const string ColFusionRuns   = "fusion_runs";
        private const string ColFusionConfig = "fusion_config";
        private const string ConfigDocId     = "default";
        private const string DefaultConfigDocId = "default";
        private static string ConfigDocIdFor(string? projectId) =>
            string.IsNullOrWhiteSpace(projectId) ? DefaultConfigDocId : projectId;

        // Max wall-clock time a single fusion run is allowed to take before we cancel it
        // and mark it as failed. Keep this in sync with FusionSchedulerService.FusionTimeout.
        private static readonly TimeSpan FusionTimeout = TimeSpan.FromMinutes(30);

        // ── History ──────────────────────────────────────────────────────────

        public List<FusionRunDto> GetHistory(int limit = 50)
        {
            var docs = _db.Collection(ColFusionRuns)
                .OrderByDescending("StartedAtUnix")
                .Limit(limit)
                .GetSnapshotAsync().Result.Documents;

            return docs.Select(d => ToDto(d.ConvertTo<FusionRun>())).ToList();
        }

        // ── Delete a run ──────────────────────────────────────────────────────

        public async Task DeleteRunAsync(string runId)
        {
            await _db.Collection(ColFusionRuns).Document(runId).DeleteAsync();
        }

        // ── Cancel a running run ──────────────────────────────────────────────
        public async Task<bool> CancelRunAsync(string runId)
        {
            var docRef = _db.Collection(ColFusionRuns).Document(runId);
            var snap   = await docRef.GetSnapshotAsync();
            if (!snap.Exists) return false;

            var run = snap.ConvertTo<FusionRun>();
            if (run.Status != "running")
            {
                _logger.LogInformation(
                    "Cancel requested for fusion {RunId} but status is {Status} — ignored.",
                    runId, run.Status);
                return false;
            }

            await docRef.UpdateAsync(new Dictionary<string, object>
            {
                { "Status", "cancelling" },
            });

            bool signalled = _cancelRegistry.TryCancel(runId);
            if (!signalled)
            {
                // Nothing registered — either the process restarted and lost the CTS, or the
                // background task already finished. Mark it cancelled directly so the UI unblocks.
                _logger.LogWarning(
                    "No in-process CTS for fusion {RunId}; marking cancelled directly.", runId);
                await docRef.UpdateAsync(new Dictionary<string, object>
                {
                    { "Status",          "cancelled" },
                    { "ErrorMessage",    "Cancelled by user (no active token)." },
                    { "CompletedAtUnix", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0 },
                });
            }

            return true;
        }

        // ── Trigger ───────────────────────────────────────────────────────────

        public FusionRunDto TriggerFusion(
            double fromUnix,
            double toUnix,
            string triggeredBy = "manual",
            string? projectId = null)
        {
            var run = new FusionRun
            {
                Status        = "running",
                TriggeredBy   = triggeredBy,
                FromDateUnix  = fromUnix,
                ToDateUnix    = toUnix,
                StartedAtUnix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0,
                ProjectId     = projectId,
            };

            var docRef = _db.Collection(ColFusionRuns).AddAsync(run).Result;
            var runId  = docRef.Id;

            var gcs      = _gcs;
            var db       = _db;
            var log      = _logger;
            var registry = _cancelRegistry;

            _ = Task.Run(async () =>
            {
                // Two sources of cancellation:
                //   • userCts    — tripped by FusionService.CancelRunAsync via the registry
                //   • timeoutCts — tripped automatically after FusionTimeout elapses
                // linked.Token is observed by FusionRunner at every I/O boundary (GCS,
                // Firestore, ReadLineAsync, Parallel.ForEachAsync) and at the phase checkpoints.
                using var userCts    = new CancellationTokenSource();
                using var timeoutCts = new CancellationTokenSource(FusionTimeout);
                using var linked     = CancellationTokenSource.CreateLinkedTokenSource(
                                           userCts.Token, timeoutCts.Token);

                registry.Register(runId, userCts);

                try
                {
                    var runner = new FusionRunner(gcs, db);

                    var fromUtc = DateTimeOffset.FromUnixTimeSeconds((long)fromUnix).UtcDateTime;
                    var toUtc   = DateTimeOffset.FromUnixTimeSeconds((long)toUnix).UtcDateTime;

                    var result = await runner.RunAsync(
                        new FusionRequest
                        {
                            From                = fromUtc,
                            To                  = toUtc,
                            InputStorageFolder  = projectId != null ? $"vision/tracks-raw/{projectId}"   : null,
                            OutputStorageFolder = projectId != null ? $"vision/tracks-fused/{projectId}" : null,
                        },
                        debug: false,
                        ct: linked.Token);

                    if (!result.Success)
                        throw new InvalidOperationException(result.Message);

                    string fromStr   = fromUtc.Date.ToString("yyyyMMdd");
                    string toStr     = toUtc.Date.ToString("yyyyMMdd");
                    string folder    = projectId != null ? $"vision/tracks-fused/{projectId}" : "vision/tracks-fused";
                    string outputKey = fromStr == toStr
                        ? $"{folder}/fused_tracks-{fromStr}.json"
                        : $"{folder}/fused_tracks-{fromStr}_{toStr}.json";

                    await docRef.UpdateAsync(new Dictionary<string, object>
                    {
                        { "Status",          "success" },
                        { "RecordsFused",    0 },
                        { "OutputGcsPath",   outputKey },
                        { "CompletedAtUnix", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0 },
                    });

                    log.LogInformation("Fusion {RunId} completed → {Output}", runId, outputKey);
                }
                catch (OperationCanceledException) when (userCts.IsCancellationRequested)
                {
                    log.LogWarning("Fusion {RunId} cancelled by user", runId);
                    await docRef.UpdateAsync(new Dictionary<string, object>
                    {
                        { "Status",          "cancelled" },
                        { "ErrorMessage",    "Cancelled by user" },
                        { "CompletedAtUnix", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0 },
                    });
                }
                catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
                {
                    var msg = $"Fusion timed out after {FusionTimeout.TotalMinutes:0} minutes";
                    log.LogError("Fusion {RunId} timed out after {Timeout}", runId, FusionTimeout);
                    await docRef.UpdateAsync(new Dictionary<string, object>
                    {
                        { "Status",          "failed" },
                        { "ErrorMessage",    msg },
                        { "CompletedAtUnix", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0 },
                    });
                }
                catch (Exception ex)
                {
                    log.LogError(ex, "Fusion {RunId} failed", runId);
                    await docRef.UpdateAsync(new Dictionary<string, object>
                    {
                        { "Status",          "failed" },
                        { "ErrorMessage",    ex.Message },
                        { "CompletedAtUnix", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0 },
                    });
                }
                finally
                {
                    registry.Unregister(runId);
                }
            });

            run.Id = runId;
            return ToDto(run);
        }

        // ── Signed download URL for a fused output file ───────────────────────

        public async Task<string?> GetDownloadUrlAsync(string runId)
        {
            var snap = await _db.Collection(ColFusionRuns).Document(runId).GetSnapshotAsync();
            if (!snap.Exists) return null;

            var run = snap.ConvertTo<FusionRun>();
            if (string.IsNullOrWhiteSpace(run.OutputGcsPath)) return null;

            var dto = await _gcs.CreateSignedDownloadUrlAsync(
                new RequestDownloadUrlDto(run.OutputGcsPath),
                CancellationToken.None);

            return dto.SignedUrl;
        }

        // ── Config ────────────────────────────────────────────────────────────

        public FusionConfigDto GetConfig(string? projectId = null)
        {
            var docId = ConfigDocIdFor(projectId);
            var snap  = _db.Collection(ColFusionConfig).Document(docId).GetSnapshotAsync().Result;

            if (!snap.Exists)
                return new FusionConfigDto(21, 0, true, projectId);

            var cfg = snap.ConvertTo<FusionConfig>();
            return new FusionConfigDto(cfg.ScheduledHourUtc, cfg.ScheduledMinuteUtc, cfg.Enabled, cfg.ProjectId ?? projectId);
        }

        public FusionConfigDto UpdateConfig(UpdateFusionConfigDto dto)
        {
            if (dto.ScheduledHourUtc is < 0 or > 23)
                throw new ArgumentOutOfRangeException(nameof(dto.ScheduledHourUtc), "Hour must be 0-23.");
            if (dto.ScheduledMinuteUtc is < 0 or > 59)
                throw new ArgumentOutOfRangeException(nameof(dto.ScheduledMinuteUtc), "Minute must be 0-59.");

            var docId = ConfigDocIdFor(dto.ProjectId);

            var oldSnap = _db.Collection(ColFusionConfig).Document(docId).GetSnapshotAsync().Result;
            FusionConfig? oldCfg = oldSnap.Exists ? oldSnap.ConvertTo<FusionConfig>() : null;

            var cfg = new FusionConfig
            {
                ScheduledHourUtc   = dto.ScheduledHourUtc,
                ScheduledMinuteUtc = dto.ScheduledMinuteUtc,
                Enabled            = dto.Enabled,
                ProjectId          = dto.ProjectId,
                UpdatedAtUnix      = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0,
            };

            _db.Collection(ColFusionConfig).Document(docId).SetAsync(cfg).Wait();

            if (oldCfg is null)
            {
                _logger.LogInformation(
                    "Fusion config initialized for project={ProjectId}: {H:D2}:{M:D2} enabled={Enabled}",
                    dto.ProjectId ?? "<default>",
                    dto.ScheduledHourUtc, dto.ScheduledMinuteUtc, dto.Enabled);
            }
            else
            {
                _logger.LogInformation(
                    "Fusion config updated for project={ProjectId}: {OldH:D2}:{OldM:D2} (enabled={OldEn}) → {NewH:D2}:{NewM:D2} (enabled={NewEn})",
                    dto.ProjectId ?? "<default>",
                    oldCfg.ScheduledHourUtc, oldCfg.ScheduledMinuteUtc, oldCfg.Enabled,
                    dto.ScheduledHourUtc,    dto.ScheduledMinuteUtc,    dto.Enabled);
            }
            return new FusionConfigDto(cfg.ScheduledHourUtc, cfg.ScheduledMinuteUtc, cfg.Enabled, cfg.ProjectId);
        }

        // ── Helpers ───────────────────────────────────────────────────────────

        private static FusionRunDto ToDto(FusionRun r) => new(
            r.Id             ?? string.Empty,
            r.Status         ?? "unknown",
            r.TriggeredBy    ?? "unknown",
            r.FromDateUnix,
            r.ToDateUnix,
            r.StartedAtUnix,
            r.CompletedAtUnix,
            r.RecordsFused,
            r.ErrorMessage,
            r.OutputGcsPath,
            r.ProjectId
        );
    }
}
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
        CloudStorageService gcs)
    {
        private readonly FirestoreDb            _db     = db;
        private readonly ILogger<FusionService> _logger = logger;
        private readonly CloudStorageService    _gcs    = gcs;

        private const string ColFusionRuns   = "fusion_runs";
        private const string ColFusionConfig = "fusion_config";
        private const string ConfigDocId     = "default";

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

            var gcs = _gcs;
            var db  = _db;
            var log = _logger;

            _ = Task.Run(async () =>
            {
                try
                {
                    var runner = new FusionRunner(gcs, db);

                    var fromUtc = DateTimeOffset.FromUnixTimeSeconds((long)fromUnix).UtcDateTime;
                    var toUtc   = DateTimeOffset.FromUnixTimeSeconds((long)toUnix).UtcDateTime;

                    var result = await runner.RunAsync(new FusionRequest
                    {
                        From                = fromUtc,
                        To                  = toUtc,
                        InputStorageFolder  = projectId != null ? $"vision/{projectId}/tracks-raw" : null,
                        OutputStorageFolder = projectId != null ? $"vision/{projectId}/fused"      : null,
                    });

                    if (!result.Success)
                        throw new InvalidOperationException(result.Message);

                    string fromStr   = fromUtc.Date.ToString("yyyyMMdd");
                    string toStr     = toUtc.Date.ToString("yyyyMMdd");
                    string folder    = projectId != null ? $"vision/{projectId}/fused" : "vision/fused";
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

        public FusionConfigDto GetConfig()
        {
            var snap = _db.Collection(ColFusionConfig).Document(ConfigDocId).GetSnapshotAsync().Result;
            if (!snap.Exists)
                return new FusionConfigDto(21, 0, true);

            var cfg = snap.ConvertTo<FusionConfig>();
            return new FusionConfigDto(cfg.ScheduledHourUtc, cfg.ScheduledMinuteUtc, cfg.Enabled, cfg.ProjectId);
        }

        public FusionConfigDto UpdateConfig(UpdateFusionConfigDto dto)
        {
            if (dto.ScheduledHourUtc is < 0 or > 23)
                throw new ArgumentOutOfRangeException(nameof(dto.ScheduledHourUtc), "Hour must be 0-23.");
            if (dto.ScheduledMinuteUtc is < 0 or > 59)
                throw new ArgumentOutOfRangeException(nameof(dto.ScheduledMinuteUtc), "Minute must be 0-59.");

            var cfg = new FusionConfig
            {
                ScheduledHourUtc   = dto.ScheduledHourUtc,
                ScheduledMinuteUtc = dto.ScheduledMinuteUtc,
                Enabled            = dto.Enabled,
                ProjectId          = dto.ProjectId,
                UpdatedAtUnix      = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0,
            };

            _db.Collection(ColFusionConfig).Document(ConfigDocId).SetAsync(cfg).Wait();
            _logger.LogInformation(
                "Fusion config updated: {Hour:D2}:{Minute:D2} UTC enabled={Enabled} project={ProjectId}",
                dto.ScheduledHourUtc, dto.ScheduledMinuteUtc, dto.Enabled, dto.ProjectId ?? "<none>");

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

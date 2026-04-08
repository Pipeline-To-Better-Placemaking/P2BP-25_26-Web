using BetterPlacemaking.Models.Dtos.Fusion;
using BetterPlacemaking.Models.Fusion;
using Google.Cloud.Firestore;
using Microsoft.Extensions.Logging;
using System.Text.Json;

namespace BetterPlacemaking.Services
{
    
    public class FusionService(FirestoreDb db, ILogger<FusionService> logger, FusionRunner fusionRunner)
    {
        private readonly FirestoreDb            _db           = db;
        private readonly ILogger<FusionService> _logger       = logger;
        // CHANGED: was missing — now stores the injected FusionRunner
        private readonly FusionRunner           _fusionRunner = fusionRunner;

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

            return docs
                .Select(d => ToDto(d.ConvertTo<FusionRun>()))
                .ToList();
        }

        // ── Manual trigger ────────────────────────────────────────────────────

        public FusionRunDto TriggerFusion(double fromUnix, double toUnix, string triggeredBy = "manual")
        {
            var run = new FusionRun
            {
                Status        = "running",
                TriggeredBy   = triggeredBy,
                FromDateUnix  = fromUnix,
                ToDateUnix    = toUnix,
                StartedAtUnix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0,
            };

            var docRef = _db.Collection(ColFusionRuns).AddAsync(run).Result;
            var runId  = docRef.Id;

            // Fire-and-forget: run the fusion logic in the background so the
            // HTTP response returns immediately with status "running".
            _ = Task.Run(async () =>
            {
                try
                {
                    var recordsFused = await ExecuteFusionAsync(fromUnix, toUnix);
                    await docRef.UpdateAsync(new Dictionary<string, object>
                    {
                        { "Status",           "success" },
                        { "RecordsFused",     recordsFused },
                        { "CompletedAtUnix",  DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0 },
                    });
                    _logger.LogInformation("Fusion {RunId} completed: {Count} records fused", runId, recordsFused);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Fusion {RunId} failed", runId);
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

        // ── Core fusion logic ─────────────────────────────────────────────────

        // CHANGED: replaced the placeholder Task.Delay stub with a real call to FusionRunner.
        //          Converts the unix-second timestamps to DateTime, runs the engine,
        //          throws on failure, and counts the fused identities from the result.
        private async Task<int> ExecuteFusionAsync(double fromUnix, double toUnix)
        {
            _logger.LogInformation("ExecuteFusionAsync: from={From} to={To}", fromUnix, toUnix);

            var result = await _fusionRunner.RunAsync(new FusionRequest
            {
                From = DateTimeOffset.FromUnixTimeMilliseconds((long)(fromUnix * 1000)).UtcDateTime,
                To   = DateTimeOffset.FromUnixTimeMilliseconds((long)(toUnix   * 1000)).UtcDateTime,
            });

            if (!result.Success)
                throw new Exception(result.Message);

            // Count the number of fused identities written to the output JSON
            if (result.Data is JsonElement je && je.ValueKind == JsonValueKind.Object)
                return je.EnumerateObject().Count();

            return 0;
        }

        // ── Config ────────────────────────────────────────────────────────────

        public FusionConfigDto GetConfig()
        {
            var snap = _db.Collection(ColFusionConfig).Document(ConfigDocId).GetSnapshotAsync().Result;
            if (!snap.Exists)
                return new FusionConfigDto(21, 0, true);

            var cfg = snap.ConvertTo<FusionConfig>();
            return new FusionConfigDto(cfg.ScheduledHourUtc, cfg.ScheduledMinuteUtc, cfg.Enabled);
        }

        public FusionConfigDto UpdateConfig(UpdateFusionConfigDto dto)
        {
            if (dto.ScheduledHourUtc < 0 || dto.ScheduledHourUtc > 23)
                throw new ArgumentOutOfRangeException(nameof(dto.ScheduledHourUtc), "Hour must be 0-23.");
            if (dto.ScheduledMinuteUtc < 0 || dto.ScheduledMinuteUtc > 59)
                throw new ArgumentOutOfRangeException(nameof(dto.ScheduledMinuteUtc), "Minute must be 0-59.");

            var cfg = new FusionConfig
            {
                ScheduledHourUtc   = dto.ScheduledHourUtc,
                ScheduledMinuteUtc = dto.ScheduledMinuteUtc,
                Enabled            = dto.Enabled,
                UpdatedAtUnix      = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0,
            };

            _db.Collection(ColFusionConfig).Document(ConfigDocId).SetAsync(cfg).Wait();
            _logger.LogInformation(
                "Fusion config updated: {Hour:D2}:{Minute:D2} UTC enabled={Enabled}",
                dto.ScheduledHourUtc, dto.ScheduledMinuteUtc, dto.Enabled);

            return new FusionConfigDto(cfg.ScheduledHourUtc, cfg.ScheduledMinuteUtc, cfg.Enabled);
        }

        // ── Helpers ───────────────────────────────────────────────────────────

        private static FusionRunDto ToDto(FusionRun r) => new(
            r.Id            ?? string.Empty,
            r.Status        ?? "unknown",
            r.TriggeredBy   ?? "unknown",
            r.FromDateUnix,
            r.ToDateUnix,
            r.StartedAtUnix,
            r.CompletedAtUnix,
            r.RecordsFused,
            r.ErrorMessage
        );
    }
}
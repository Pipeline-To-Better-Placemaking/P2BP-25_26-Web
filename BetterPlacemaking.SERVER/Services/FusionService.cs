using BetterPlacemaking.Models.Dtos.Fusion;
using BetterPlacemaking.Models.Fusion;
using Google.Cloud.Firestore;
using Microsoft.Extensions.Logging;

namespace BetterPlacemaking.Services
{
    public class FusionService(FirestoreDb db, ILogger<FusionService> logger)
    {
        private readonly FirestoreDb _db = db;
        private readonly ILogger<FusionService> _logger = logger;

        private const string ColFusionRuns = "fusion_runs";
        private const string ColFusionConfig = "fusion_config";
        private const string ConfigDocId = "default";

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
                Status = "running",
                TriggeredBy = triggeredBy,
                FromDateUnix = fromUnix,
                ToDateUnix = toUnix,
                StartedAtUnix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0,
            };

            var docRef = _db.Collection(ColFusionRuns).AddAsync(run).Result;
            var runId = docRef.Id;

            // Fire-and-forget: run the fusion logic in the background so the
            // HTTP response returns immediately with status "running".
            _ = Task.Run(async () =>
            {
                try
                {
                    var recordsFused = await ExecuteFusionAsync(fromUnix, toUnix);
                    await docRef.UpdateAsync(new Dictionary<string, object>
                    {
                        { "Status", "success" },
                        { "RecordsFused", recordsFused },
                        { "CompletedAtUnix", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0 },
                    });
                    _logger.LogInformation("Fusion {RunId} completed: {Count} records fused", runId, recordsFused);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Fusion {RunId} failed", runId);
                    await docRef.UpdateAsync(new Dictionary<string, object>
                    {
                        { "Status", "failed" },
                        { "ErrorMessage", ex.Message },
                        { "CompletedAtUnix", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0 },
                    });
                }
            });

            run.Id = runId;
            return ToDto(run);
        }

        // ── Core fusion logic ─────────────────────────────────────────────────

        /// <summary>
        /// Execute the fusion script for the given date range.
        /// Replace the body of this method with your actual C# fusion logic
        /// (ported from the Python script).
        /// Returns the number of records fused.
        /// </summary>
        private async Task<int> ExecuteFusionAsync(double fromUnix, double toUnix)
        {
            // TODO: replace with real fusion logic
            // e.g. query sightings between fromUnix and toUnix, run fusion algorithm, write results
            _logger.LogInformation("ExecuteFusionAsync: from={From} to={To}", fromUnix, toUnix);
            await Task.Delay(500); // placeholder async work
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
                ScheduledHourUtc = dto.ScheduledHourUtc,
                ScheduledMinuteUtc = dto.ScheduledMinuteUtc,
                Enabled = dto.Enabled,
                UpdatedAtUnix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0,
            };

            _db.Collection(ColFusionConfig).Document(ConfigDocId).SetAsync(cfg).Wait();
            _logger.LogInformation(
                "Fusion config updated: {Hour:D2}:{Minute:D2} UTC enabled={Enabled}",
                dto.ScheduledHourUtc, dto.ScheduledMinuteUtc, dto.Enabled);

            return new FusionConfigDto(cfg.ScheduledHourUtc, cfg.ScheduledMinuteUtc, cfg.Enabled);
        }

        // ── Helpers ───────────────────────────────────────────────────────────

        private static FusionRunDto ToDto(FusionRun r) => new(
            r.Id ?? string.Empty,
            r.Status ?? "unknown",
            r.TriggeredBy ?? "unknown",
            r.FromDateUnix,
            r.ToDateUnix,
            r.StartedAtUnix,
            r.CompletedAtUnix,
            r.RecordsFused,
            r.ErrorMessage
        );
    }
}

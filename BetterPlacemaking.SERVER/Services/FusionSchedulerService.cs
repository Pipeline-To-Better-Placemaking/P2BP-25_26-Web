using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Google.Cloud.Firestore;
using BetterPlacemaking.Models.Fusion;

namespace BetterPlacemaking.Services
{
    public class FusionSchedulerService(
        IServiceScopeFactory scopeFactory,
        ILogger<FusionSchedulerService> logger) : BackgroundService
    {
        // A single scheduled run is allowed this long before we treat it as stuck/timed-out.
        // Stale "running" entries older than this are ignored so a crashed run can't block
        // the scheduler forever.
        private static readonly TimeSpan FusionTimeout = TimeSpan.FromMinutes(15);

        protected override async Task ExecuteAsync(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    using var scope = scopeFactory.CreateScope();
                    var fusionService = scope.ServiceProvider.GetRequiredService<FusionService>();
                    var db            = scope.ServiceProvider.GetRequiredService<FirestoreDb>();

                    // Global concurrency guard: if ANY fusion is currently running, skip this
                    // tick entirely. Don't try to start another one on top of it.
                    if (IsAnyFusionRunning(fusionService))
                    {
                        logger.LogDebug("A fusion is already running; skipping this tick.");
                        await Task.Delay(TimeSpan.FromMinutes(10), ct);
                        continue;
                    }

                    var allConfigs = await db.Collection("fusion_config").GetSnapshotAsync(ct);

                    foreach (var doc in allConfigs.Documents)
                    {
                        var cfg = doc.ConvertTo<FusionConfig>();
                        if (!cfg.Enabled) continue;

                        var now = DateTime.UtcNow;
                        var scheduledToday = new DateTime(
                            now.Year, now.Month, now.Day,
                            cfg.ScheduledHourUtc, cfg.ScheduledMinuteUtc, 0,
                            DateTimeKind.Utc);

                        // Not time yet, or we've already attempted this project today
                        // (success, still running, OR failed). Treating "failed" as attempted
                        // is the key fix that stops the scheduler from retrying every minute
                        // after a failure.
                        if (now < scheduledToday || AlreadyAttemptedToday(fusionService, cfg.ProjectId))
                            continue;

                        logger.LogInformation(
                            "Scheduler triggering daily fusion for project {ProjectId} ({Date:yyyy-MM-dd})",
                            cfg.ProjectId ?? "<default>", now.Date);

                        var windowEnd   = scheduledToday;               // today at HH:MM UTC
                        var windowStart = scheduledToday.AddHours(-24); // 24 hours before that

                        try
                        {
                            fusionService.TriggerFusion(
                                new DateTimeOffset(windowStart).ToUnixTimeSeconds(),
                                new DateTimeOffset(windowEnd).ToUnixTimeSeconds(),
                                triggeredBy: "scheduler",
                                projectId:   cfg.ProjectId);
                        }
                        catch (Exception ex)
                        {
                            // The run should already be recorded as "failed" in history by
                            // FusionService. Even if it isn't, AlreadyAttemptedToday treats
                            // "failed" as attempted, so we will NOT retry today.
                            logger.LogError(ex,
                                "Scheduled fusion failed for project {ProjectId}; not retrying today.",
                                cfg.ProjectId ?? "<default>");
                        }

                        // Serialize: only kick off one fusion per tick so we never start
                        // two back-to-back from a single scheduler pass.
                        break;
                    }
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Fusion scheduler error");
                }

                await Task.Delay(TimeSpan.FromMinutes(1), ct);
            }
        }

        /// <summary>
        /// True if any fusion is currently in 'running' state and hasn't exceeded the
        /// configured timeout. Stale "running" entries older than <see cref="FusionTimeout"/>
        /// are ignored so a silently-crashed run doesn't block the scheduler forever.
        /// </summary>
        private static bool IsAnyFusionRunning(FusionService fusionService)
        {
            var cutoffUnix = new DateTimeOffset(DateTime.UtcNow - FusionTimeout).ToUnixTimeSeconds();
            return fusionService.GetHistory(50).Any(r =>
                r.Status == "running" &&
                r.StartedAtUnix >= cutoffUnix);
        }

        /// <summary>
        /// Returns true if the scheduler already attempted this project today — whether
        /// the run succeeded, is still running, or failed. Treating "failed" as attempted
        /// is what stops the scheduler from retrying every minute after a failure.
        /// </summary>
        private static bool AlreadyAttemptedToday(FusionService fusionService, string? projectId)
        {
            var startOfDay = new DateTimeOffset(DateTime.UtcNow.Date).ToUnixTimeSeconds();
            return fusionService.GetHistory(50).Any(r =>
                r.StartedAtUnix >= startOfDay &&
                r.TriggeredBy == "scheduler" &&
                r.ProjectId == projectId &&
                (r.Status == "success" || r.Status == "running" || r.Status == "failed"));
        }
    }
}
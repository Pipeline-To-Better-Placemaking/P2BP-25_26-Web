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
        protected override async Task ExecuteAsync(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    using var scope = scopeFactory.CreateScope();
                    var fusionService = scope.ServiceProvider.GetRequiredService<FusionService>();
                    var db            = scope.ServiceProvider.GetRequiredService<FirestoreDb>();

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

                        if (now >= scheduledToday && !AlreadyRanToday(fusionService, cfg.ProjectId))
                        {
                            logger.LogInformation(
                                "Scheduler triggering daily fusion for project {ProjectId} ({Date:yyyy-MM-dd})",
                                cfg.ProjectId ?? "<default>", now.Date);

                            var windowEnd   = scheduledToday;               // today at HH:MM UTC
                            var windowStart = scheduledToday.AddHours(-24); // 24 hours before that

                            fusionService.TriggerFusion(
                                new DateTimeOffset(windowStart).ToUnixTimeSeconds(),
                                new DateTimeOffset(windowEnd).ToUnixTimeSeconds(),
                                triggeredBy: "scheduler",
                                projectId:   cfg.ProjectId);
                        }
                    }
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Fusion scheduler error");
                }

                await Task.Delay(TimeSpan.FromMinutes(1), ct);
            }
        }

        private static bool AlreadyRanToday(FusionService fusionService, string? projectId)
        {
            var startOfDay = new DateTimeOffset(DateTime.UtcNow.Date).ToUnixTimeSeconds();
            return fusionService.GetHistory(50).Any(r =>
                r.StartedAtUnix >= startOfDay &&
                r.TriggeredBy == "scheduler" &&
                r.ProjectId == projectId &&
                (r.Status == "success" || r.Status == "running"));
        }
    }
}
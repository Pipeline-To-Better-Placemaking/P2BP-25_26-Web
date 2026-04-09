using BetterPlacemaking.Services;
using Hangfire;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace BetterPlacemaking.BackgroundServices
{
    /// <summary>
    /// Registers and maintains the nightly Hangfire recurring job for fusion.
    /// The schedule is re-read from Firestore each time SaveSchedule() is called
    /// (triggered by PUT /api/fusion/config), so changes take effect immediately
    /// without a restart.
    /// </summary>
    public class FusionBackgroundService(
        IRecurringJobManager recurringJobs,
        FusionService fusionService,
        ILogger<FusionBackgroundService> logger) : IHostedService
    {
        private readonly IRecurringJobManager _recurringJobs = recurringJobs;
        private readonly FusionService _fusionService = fusionService;
        private readonly ILogger<FusionBackgroundService> _logger = logger;

        private const string JobId = "nightly-fusion";

        public Task StartAsync(CancellationToken cancellationToken)
        {
            SaveSchedule();
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        /// <summary>
        /// (Re-)registers the Hangfire recurring job using the current config.
        /// Call this after every PUT /api/fusion/config so the new time takes effect immediately.
        /// </summary>
        public void SaveSchedule()
        {
            var config = _fusionService.GetConfig();

            if (!config.Enabled)
            {
                _recurringJobs.RemoveIfExists(JobId);
                _logger.LogInformation("Nightly fusion job disabled — removed from Hangfire.");
                return;
            }

            // Hangfire cron: "minute hour * * *"
            var cron = $"{config.ScheduledMinuteUtc} {config.ScheduledHourUtc} * * *";

            _recurringJobs.AddOrUpdate(
                JobId,
                () => RunScheduledFusion(),
                cron,
                new RecurringJobOptions { TimeZone = TimeZoneInfo.Utc }
            );

            _logger.LogInformation(
                "Nightly fusion job scheduled: {Hour:D2}:{Minute:D2} UTC (cron: {Cron})",
                config.ScheduledHourUtc, config.ScheduledMinuteUtc, cron);
        }

        /// <summary>
        /// The method Hangfire actually invokes on schedule.
        /// Fuses yesterday's data by default (midnight-to-midnight UTC).
        /// </summary>
        [AutomaticRetry(Attempts = 0)] // Don't retry fusion — duplicates would corrupt data
        public void RunScheduledFusion()
        {
            var today = DateTime.UtcNow.Date;
            var yesterday = today.AddDays(-1);

            var fromUnix = new DateTimeOffset(yesterday, TimeSpan.Zero).ToUnixTimeSeconds();
            var toUnix = new DateTimeOffset(today, TimeSpan.Zero).ToUnixTimeSeconds();

            var fusionConfig = _fusionService.GetConfig();
            if (string.IsNullOrWhiteSpace(fusionConfig.ProjectId))
            {
                _logger.LogWarning("Hangfire: skipping scheduled fusion — ProjectId not set in fusion config. Set it via PUT /api/fusion/config.");
                return;
            }

            _logger.LogInformation("Hangfire: running scheduled fusion for {Date:yyyy-MM-dd} (project={ProjectId})", yesterday, fusionConfig.ProjectId);
            _fusionService.TriggerFusion(fromUnix, toUnix, "scheduled", fusionConfig.ProjectId);
        }
    }
}
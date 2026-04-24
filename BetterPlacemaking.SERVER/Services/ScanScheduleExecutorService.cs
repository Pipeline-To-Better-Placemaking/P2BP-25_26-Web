using System.Globalization;
using BetterPlacemaking.Models;
using Google.Cloud.Firestore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace BetterPlacemaking.Services
{
    /// <summary>
    /// Polls scan_schedules across all projects every minute. Treats each schedule as a one-shot:
    /// the first tick where StartDate+StartTime is in the past AND LastRunAt is null fires a scan
    /// via ScanService.CreateScan (identical call to what the manual "Perform Scan" button uses).
    /// Frequency and EndDate are ignored for now — recurrence is future work.
    ///
    /// Time semantics: StartDate (yyyy-MM-dd) and StartTime (HH:mm) are stored by the frontend
    /// as the user's local wall-clock. We compare against DateTime.Now (server local) — correct
    /// when the server TZ matches users' TZ (localhost / co-located deploy). A UTC cloud server
    /// with users in a non-UTC TZ would fire at the wrong wall-clock time; fix later by storing
    /// a per-schedule timezone or converting on the frontend before submit.
    /// </summary>
    public class ScanScheduleExecutorService(
        IServiceScopeFactory scopeFactory,
        ILogger<ScanScheduleExecutorService> logger) : BackgroundService
    {
        private static readonly TimeSpan Tick = TimeSpan.FromMinutes(1);

        protected override async Task ExecuteAsync(CancellationToken ct)
        {
            logger.LogInformation("Scan schedule executor started (tick every {TickSeconds}s)", Tick.TotalSeconds);

            while (!ct.IsCancellationRequested)
            {
                try
                {
                    await TickOnceAsync(ct).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Scan schedule executor tick failed");
                }

                try { await Task.Delay(Tick, ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { break; }
            }
        }

        private async Task TickOnceAsync(CancellationToken ct)
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<FirestoreDb>();
            var scanService = scope.ServiceProvider.GetRequiredService<ScanService>();
            var deviceService = scope.ServiceProvider.GetRequiredService<DeviceService>();

            var snap = await db.CollectionGroup("scan_schedules").GetSnapshotAsync(ct).ConfigureAwait(false);
            var now = DateTime.Now;

            int total = 0, notYetDue = 0, alreadyFired = 0, fired = 0, skipped = 0;

            foreach (var doc in snap.Documents)
            {
                total++;
                try
                {
                    var outcome = await ProcessOneAsync(doc, now, db, scanService, deviceService, ct).ConfigureAwait(false);
                    switch (outcome)
                    {
                        case Outcome.NotYetDue: notYetDue++; break;
                        case Outcome.AlreadyFired: alreadyFired++; break;
                        case Outcome.Fired: fired++; break;
                        case Outcome.Skipped: skipped++; break;
                    }
                }
                catch (Exception ex)
                {
                    skipped++;
                    logger.LogError(ex, "Scan schedule {ScheduleId} failed to process", doc.Id);
                }
            }

            logger.LogInformation(
                "Tick complete: {Total} schedules ({NotYetDue} not-yet-due, {AlreadyFired} already-fired, {Fired} fired, {Skipped} skipped)",
                total, notYetDue, alreadyFired, fired, skipped);
        }

        private async Task<Outcome> ProcessOneAsync(
            DocumentSnapshot doc, DateTime now, FirestoreDb db,
            ScanService scanService, DeviceService deviceService, CancellationToken ct)
        {
            var schedule = doc.ConvertTo<ScanSchedule>();
            var scheduleId = doc.Id;

            // One-shot guard: any non-null LastRunAt means "already fired, ever".
            if (schedule.LastRunAt.HasValue)
                return Outcome.AlreadyFired;

            if (!TryParseLocal(schedule.StartDate, schedule.StartTime, out var startAt))
            {
                logger.LogWarning("Scan schedule {ScheduleId}: unparseable StartDate/StartTime ({StartDate} / {StartTime})",
                    scheduleId, schedule.StartDate, schedule.StartTime);
                return Outcome.Skipped;
            }

            if (now < startAt)
                return Outcome.NotYetDue;

            var projectId = doc.Reference.Parent.Parent?.Id;
            if (string.IsNullOrWhiteSpace(projectId))
            {
                logger.LogWarning("Scan schedule {ScheduleId}: missing projectId from doc path", scheduleId);
                return Outcome.Skipped;
            }

            var device = deviceService.GetDevicesByProjectId(projectId)
                .FirstOrDefault(d => d.Name != null && d.Name.Contains("lidar", StringComparison.OrdinalIgnoreCase));
            if (device == null || string.IsNullOrWhiteSpace(device.Id))
            {
                logger.LogWarning(
                    "Scan schedule {ScheduleId}: no lidar device in project {ProjectId}; retry next tick",
                    scheduleId, projectId);
                return Outcome.Skipped;
            }

            // Mirror the manual "Perform Scan" button's 409 guard: don't fire on top of an active scan.
            var inFlight = scanService.HasPendingOrRunningScan(projectId, device.Id!);
            if (inFlight.Exists)
            {
                logger.LogInformation(
                    "Scan schedule {ScheduleId}: deferred, scan {ActiveScanId} already {Status}",
                    scheduleId, inFlight.ScanId, inFlight.Status);
                return Outcome.Skipped;
            }

            // Transactional one-shot claim: re-read LastRunAt inside the tx so concurrent replicas
            // can't both fire the same schedule.
            var claimed = await db.RunTransactionAsync<bool>(async tx =>
            {
                var fresh = await tx.GetSnapshotAsync(doc.Reference).ConfigureAwait(false);
                if (!fresh.Exists) return false;

                var latest = fresh.ConvertTo<ScanSchedule>();
                if (latest.LastRunAt.HasValue) return false;

                tx.Update(doc.Reference, new Dictionary<string, object>
                {
                    { nameof(ScanSchedule.LastRunAt), Timestamp.FromDateTime(DateTime.UtcNow) }
                });
                return true;
            }, cancellationToken: ct).ConfigureAwait(false);

            if (!claimed)
                return Outcome.AlreadyFired;

            try
            {
                var result = scanService.CreateScan(
                    projectId,
                    device.Id!,
                    DefaultScanSettings.ForScheduledRun(),
                    initiatedByUserId: schedule.CreatedByUserId);

                var scanId = result.GetType().GetProperty("Id")?.GetValue(result)?.ToString() ?? "<unknown>";
                logger.LogInformation(
                    "Scheduler fired scan {ScanId} for project {ProjectId} device {DeviceId} schedule {ScheduleId}",
                    scanId, projectId, device.Id, scheduleId);
                return Outcome.Fired;
            }
            catch (Exception ex)
            {
                // LastRunAt is already stamped; we won't auto-retry. Intentional: a stuck CreateScan
                // failing in a tight loop is worse than leaving the schedule in "ran, no scan doc"
                // state. User can manually re-trigger via Perform Scan.
                logger.LogError(ex,
                    "Scheduler stamped LastRunAt for schedule {ScheduleId} but CreateScan failed; manual retry required",
                    scheduleId);
                return Outcome.Skipped;
            }
        }

        private static bool TryParseLocal(string? date, string? time, out DateTime value)
        {
            value = default;
            if (string.IsNullOrWhiteSpace(date) || string.IsNullOrWhiteSpace(time)) return false;
            var composed = $"{date.Trim()}T{time.Trim()}";
            return DateTime.TryParseExact(
                composed,
                new[] { "yyyy-MM-ddTHH:mm", "yyyy-MM-ddTHH:mm:ss" },
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal,
                out value);
        }

        private enum Outcome
        {
            NotYetDue,
            AlreadyFired,
            Fired,
            Skipped,
        }
    }
}

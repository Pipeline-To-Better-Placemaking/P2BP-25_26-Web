using System.Globalization;
using BetterPlacemaking.Models;
using Google.Cloud.Firestore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace BetterPlacemaking.Services
{
    /// <summary>
    /// Polls scan_schedules across all projects every minute. When a schedule is due per its
    /// Frequency (Never/Weekly/Monthly/Yearly) and has not already been fired for the current
    /// slot, transactionally stamps LastRunAt and fires a scan via ScanService.CreateScan.
    ///
    /// Time semantics: StartDate (yyyy-MM-dd) and StartTime (HH:mm) are stored by the frontend
    /// as the user's local wall-clock (scanner.ts formatDate/formatTime use getFullYear/getHours).
    /// We therefore compare against DateTime.Now (server local) — works when the server TZ
    /// matches users' TZ (localhost / co-located deploy). For a cloud deploy with a UTC server
    /// and users in a non-UTC TZ, schedules will fire at the wrong wall-clock time; fix by
    /// storing a per-schedule timezone or converting on the frontend before submit.
    /// </summary>
    public class ScanScheduleExecutorService(
        IServiceScopeFactory scopeFactory,
        ILogger<ScanScheduleExecutorService> logger) : BackgroundService
    {
        private static readonly TimeSpan Tick = TimeSpan.FromMinutes(1);

        protected override async Task ExecuteAsync(CancellationToken ct)
        {
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

            foreach (var doc in snap.Documents)
            {
                try
                {
                    await ProcessOneAsync(doc, now, db, scanService, deviceService, ct).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Scan schedule {ScheduleId} failed to process", doc.Id);
                }
            }
        }

        private async Task ProcessOneAsync(
            DocumentSnapshot doc, DateTime now, FirestoreDb db,
            ScanService scanService, DeviceService deviceService, CancellationToken ct)
        {
            var schedule = doc.ConvertTo<ScanSchedule>();
            var scheduleId = doc.Id;

            if (!TryParseLocal(schedule.StartDate, schedule.StartTime, out var startAt))
            {
                logger.LogWarning("Scan schedule {ScheduleId}: unparseable StartDate/StartTime", scheduleId);
                return;
            }

            DateTime? endAt = null;
            if (!string.IsNullOrWhiteSpace(schedule.EndDate) && !string.IsNullOrWhiteSpace(schedule.EndTime))
            {
                if (TryParseLocal(schedule.EndDate, schedule.EndTime, out var parsedEnd))
                    endAt = parsedEnd;
            }

            if (endAt.HasValue && now > endAt.Value)
                return; // expired

            var frequency = (schedule.Frequency ?? string.Empty).Trim();
            var lastRun = schedule.LastRunAt?.ToDateTime().ToLocalTime();

            // One-shot semantics: "Never" fires once at startAt, ever.
            if (string.Equals(frequency, "Never", StringComparison.OrdinalIgnoreCase))
            {
                if (lastRun.HasValue) return;
                if (now < startAt) return;
                await FireAsync(doc, schedule, scheduleId, startAt, db, scanService, deviceService, ct).ConfigureAwait(false);
                return;
            }

            // Recurring: compute the latest slot <= now.
            if (!TryComputeDueSlot(startAt, frequency, now, out var dueAt))
            {
                logger.LogWarning("Scan schedule {ScheduleId}: unknown Frequency '{Frequency}'", scheduleId, frequency);
                return;
            }

            if (dueAt > now) return;                               // not yet due
            if (lastRun.HasValue && lastRun.Value >= dueAt) return; // this slot already fired

            await FireAsync(doc, schedule, scheduleId, dueAt, db, scanService, deviceService, ct).ConfigureAwait(false);
        }

        private async Task FireAsync(
            DocumentSnapshot doc, ScanSchedule schedule, string scheduleId, DateTime dueAt,
            FirestoreDb db, ScanService scanService, DeviceService deviceService, CancellationToken ct)
        {
            var projectId = doc.Reference.Parent.Parent?.Id;
            if (string.IsNullOrWhiteSpace(projectId))
            {
                logger.LogWarning("Scan schedule {ScheduleId}: missing projectId from doc path", scheduleId);
                return;
            }

            var device = deviceService.GetDevicesByProjectId(projectId)
                .FirstOrDefault(d => d.Name != null && d.Name.Contains("lidar", StringComparison.OrdinalIgnoreCase));
            if (device == null || string.IsNullOrWhiteSpace(device.Id))
            {
                logger.LogWarning(
                    "Scan schedule {ScheduleId} due at {DueAt:O}: no lidar device in project {ProjectId}",
                    scheduleId, dueAt, projectId);
                return;
            }

            // Multi-replica safe: re-read LastRunAt inside the tx. If another replica already
            // claimed this slot since we decided to fire, abort without creating a duplicate scan.
            var claimed = await db.RunTransactionAsync<bool>(async tx =>
            {
                var fresh = await tx.GetSnapshotAsync(doc.Reference).ConfigureAwait(false);
                if (!fresh.Exists) return false;

                var latest = fresh.ConvertTo<ScanSchedule>();
                var lastRun = latest.LastRunAt?.ToDateTime().ToLocalTime();
                if (lastRun.HasValue && lastRun.Value >= dueAt)
                    return false;

                tx.Update(doc.Reference, new Dictionary<string, object>
                {
                    { nameof(ScanSchedule.LastRunAt), Timestamp.FromDateTime(DateTime.UtcNow) }
                });
                return true;
            }, cancellationToken: ct).ConfigureAwait(false);

            if (!claimed) return;

            try
            {
                var result = scanService.CreateScan(
                    projectId,
                    device.Id!,
                    DefaultScanSettings.ForScheduledRun(),
                    initiatedByUserId: schedule.CreatedByUserId);

                var scanId = result.GetType().GetProperty("Id")?.GetValue(result)?.ToString() ?? "<unknown>";
                logger.LogInformation(
                    "Scheduler fired scan {ScanId} for project {ProjectId} device {DeviceId} schedule {ScheduleId} (due {DueAt:O})",
                    scanId, projectId, device.Id, scheduleId, dueAt);
            }
            catch (Exception ex)
            {
                // LastRunAt is already stamped, so we won't re-fire this slot. That is intentional:
                // repeated CreateScan failures in a tight loop would be worse than a single missed slot.
                logger.LogError(ex,
                    "Scheduler stamped LastRunAt for schedule {ScheduleId} but CreateScan failed; user must retry manually",
                    scheduleId);
            }
        }

        // --- helpers ---

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

        private static bool TryComputeDueSlot(DateTime startAt, string frequency, DateTime now, out DateTime dueAt)
        {
            dueAt = startAt;
            if (now < startAt) return true; // will be skipped by caller (dueAt > now)

            switch (frequency.ToLowerInvariant())
            {
                case "weekly":
                {
                    var days = (int)Math.Floor((now - startAt).TotalDays);
                    var weeks = days / 7;
                    dueAt = startAt.AddDays(weeks * 7);
                    return true;
                }
                case "monthly":
                {
                    var months = ((now.Year - startAt.Year) * 12) + (now.Month - startAt.Month);
                    // Back off if the day-of-month for this candidate hasn't arrived yet.
                    var candidate = startAt.AddMonths(months);
                    if (candidate > now) candidate = startAt.AddMonths(months - 1);
                    dueAt = candidate;
                    return true;
                }
                case "yearly":
                {
                    var years = now.Year - startAt.Year;
                    var candidate = startAt.AddYears(years);
                    if (candidate > now) candidate = startAt.AddYears(years - 1);
                    dueAt = candidate;
                    return true;
                }
                default:
                    return false;
            }
        }
    }
}

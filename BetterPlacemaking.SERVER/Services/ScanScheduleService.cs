using Google.Cloud.Firestore;
using BetterPlacemaking.Models;

namespace BetterPlacemaking.Services;

public class ScanScheduleService(FirestoreDb db)
{
    private readonly FirestoreDb _db = db;

    private CollectionReference GetCollection(string projectId) =>
        _db.Collection("projects").Document(projectId).Collection("scan_schedules");

    public object CreateSchedule(string projectId, ScanSchedule schedule, string? createdByUserId = null)
    {
        var collection = GetCollection(projectId);
        schedule.CreatedAt = Timestamp.FromDateTime(DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Utc));
        schedule.CreatedByUserId = createdByUserId;
        var docRef = collection.Document();
        docRef.SetAsync(schedule).Wait();
        return new { Id = docRef.Id };
    }

    public List<ScanSchedule> GetSchedules(string projectId)
    {
        return GetCollection(projectId)
            .GetSnapshotAsync().Result.Documents
            .Select(doc => doc.ConvertTo<ScanSchedule>())
            .ToList();
    }

    public bool DeleteSchedule(string projectId, string scheduleId)
    {
        var docRef = GetCollection(projectId).Document(scheduleId);
        var snap = docRef.GetSnapshotAsync().Result;
        if (!snap.Exists) return false;
        docRef.DeleteAsync().Wait();
        return true;
    }

    public bool UpdateSchedule(string projectId, string scheduleId, ScanSchedule schedule)
    {
        var docRef = GetCollection(projectId).Document(scheduleId);
        var snap = docRef.GetSnapshotAsync().Result;
        if (!snap.Exists) return false;

        var updates = new Dictionary<string, object>();
        if (schedule.StartDate != null) updates["StartDate"] = schedule.StartDate;
        if (schedule.StartTime != null) updates["StartTime"] = schedule.StartTime;
        if (schedule.Frequency != null) updates["Frequency"] = schedule.Frequency;
        updates["EndDate"] = schedule.EndDate ?? "";
        updates["EndTime"] = schedule.EndTime ?? "";

        if (updates.Count > 0)
            docRef.UpdateAsync(updates).Wait();

        return true;
    }
}

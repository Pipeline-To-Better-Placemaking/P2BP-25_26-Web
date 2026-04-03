using Google.Cloud.Firestore;

namespace BetterPlacemaking.Services
{
    public class LidarService(FirestoreDb db)
    {
        private readonly FirestoreDb _db = db;
        private const string collectionName = "scan_requests";

       public object StartScan(string projectId, string deviceId)
{
    if (string.IsNullOrWhiteSpace(projectId))
        throw new ArgumentException("ProjectId is required.");

    if (string.IsNullOrWhiteSpace(deviceId))
        throw new ArgumentException("DeviceId is required.");

    var collection = _db.Collection(collectionName);
    var docRef = collection.Document();

    var scanRequest = new Dictionary<string, object>
    {
        { "ScanId", docRef.Id },
        { "ProjectId", projectId },
        { "DeviceId", deviceId },
        { "Status", "requested" },
        { "Timestamp", DateTimeOffset.UtcNow.ToUnixTimeSeconds() },
        { "FileUrl", "" },
        { "Error", "" }
    };

    docRef.SetAsync(scanRequest).Wait();

    return new
    {
        ScanId = docRef.Id,
        ProjectId = projectId,
        DeviceId = deviceId,
        Status = "requested"
    };
}

      public List<Dictionary<string, object>> GetScans(string projectId)
{
    var response = _db.Collection(collectionName)
        .WhereEqualTo("ProjectId", projectId)
        .GetSnapshotAsync()
        .Result
        .Documents
        .Select(doc =>
        {
            var data = doc.ToDictionary();
            data["ScanId"] = doc.Id;
            return data;
        })
        .ToList();

    return response;
}

        public Dictionary<string, object>? GetScan(string projectId, string id)
{
    var snap = _db.Collection(collectionName)
        .Document(id)
        .GetSnapshotAsync()
        .Result;

    if (!snap.Exists)
        return null;

    var data = snap.ToDictionary();

    if (!data.TryGetValue("ProjectId", out var storedProjectId) || storedProjectId?.ToString() != projectId)
        return null;

    data["ScanId"] = snap.Id;
    return data;
}

        public bool UpdateScanStatus(string projectId, string id, string status, string? fileUrl = null, string? error = null)
{
    var docRef = _db.Collection(collectionName).Document(id);
    var snap = docRef.GetSnapshotAsync().Result;

    if (!snap.Exists)
        return false;

    var data = snap.ToDictionary();

    if (!data.TryGetValue("ProjectId", out var storedProjectId) || storedProjectId?.ToString() != projectId)
        return false;

    var updates = new Dictionary<string, object>
    {
        { "Status", status }
    };

    if (!string.IsNullOrWhiteSpace(fileUrl))
        updates["FileUrl"] = fileUrl;

    if (!string.IsNullOrWhiteSpace(error))
        updates["Error"] = error;

    docRef.UpdateAsync(updates).Wait();
    return true;
}
    }
}
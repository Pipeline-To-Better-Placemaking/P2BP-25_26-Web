using Google.Cloud.Firestore;

namespace BetterPlacemaking.Services
{
    public class LidarService(FirestoreDb db)
    {
        private readonly FirestoreDb _db = db;
        private const string collectionName = "scan_requests";

        public object StartScan(string deviceId)
        {
            if (string.IsNullOrWhiteSpace(deviceId))
                throw new ArgumentException("DeviceId is required.");

            var scanRequest = new Dictionary<string, object>
            {
                { "DeviceId", deviceId },
                { "Status", "requested" },
                { "Timestamp", DateTimeOffset.UtcNow.ToUnixTimeSeconds() }
            };

            var collection = _db.Collection(collectionName);
            var docRef = collection.Document();

            docRef.SetAsync(scanRequest).Wait();

            return new
            {
                ScanId = docRef.Id,
                DeviceId = deviceId,
                Status = "requested"
            };
        }

        public List<Dictionary<string, object>> GetScans()
        {
            var response = _db.Collection(collectionName)
                .GetSnapshotAsync()
                .Result
                .Documents
                .Select(doc => doc.ToDictionary())
                .ToList();

            return response;
        }

        public Dictionary<string, object>? GetScan(string id)
        {
            var snap = _db.Collection(collectionName)
                .Document(id)
                .GetSnapshotAsync()
                .Result;

            if (!snap.Exists)
                return null;

            return snap.ToDictionary();
        }

        public bool UpdateScanStatus(string id, string status, string? fileUrl = null)
        {
            var docRef = _db.Collection(collectionName).Document(id);
            var snap = docRef.GetSnapshotAsync().Result;

            if (!snap.Exists)
                return false;

            var updates = new Dictionary<string, object>
            {
                { "Status", status }
            };

            if (!string.IsNullOrWhiteSpace(fileUrl))
            {
                updates["FileUrl"] = fileUrl;
            }

            docRef.UpdateAsync(updates).Wait();

            return true;
        }
    }
}
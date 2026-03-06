using Google.Cloud.Firestore;

namespace BetterPlacemaking.Services
{
    public class ScanService(FirestoreDb db)
    {
        private readonly FirestoreDb _db = db;

        public object CreateScan(string projectId, string deviceId)
        {
            var collection = _db
                .Collection("projects")
                .Document(projectId)
                .Collection("devices")
                .Document(deviceId)
                .Collection("scans");

            var scan = new Dictionary<string, object?>
            {
                { "Status", "pending" },
                { "CreatedAt", Timestamp.GetCurrentTimestamp() },
                { "StartedAt", null },
                { "FinishedAt", null },
                { "ObjUrl", null },
                { "Error", null }
            };

            var docRef = collection.Document();
            docRef.SetAsync(scan).Wait();

            return new
            {
                Id = docRef.Id,
                Status = "pending"
            };
        }

        public List<Dictionary<string, object>> GetScans(string projectId, string deviceId)
        {
            var response = _db
                .Collection("projects")
                .Document(projectId)
                .Collection("devices")
                .Document(deviceId)
                .Collection("scans")
                .GetSnapshotAsync()
                .Result
                .Documents
                .Select(doc =>
                {
                    var data = doc.ToDictionary();
                    data["Id"] = doc.Id;
                    return data;
                })
                .ToList();

            return response;
        }

        public Dictionary<string, object>? GetScan(string projectId, string deviceId, string scanId)
        {
            var snap = _db
                .Collection("projects")
                .Document(projectId)
                .Collection("devices")
                .Document(deviceId)
                .Collection("scans")
                .Document(scanId)
                .GetSnapshotAsync()
                .Result;

            if (!snap.Exists)
                return null;

            var response = snap.ToDictionary();
            response["Id"] = snap.Id;
            return response;
        }

        public bool UpdateScanStatus(string projectId, string deviceId, string scanId, string? status, string? objUrl, string? error)
        {
            var docRef = _db
                .Collection("projects")
                .Document(projectId)
                .Collection("devices")
                .Document(deviceId)
                .Collection("scans")
                .Document(scanId);

            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return false;

            var updates = new Dictionary<string, object>();

            if (!string.IsNullOrWhiteSpace(status))
                updates["Status"] = status;

            if (!string.IsNullOrWhiteSpace(objUrl))
                updates["ObjUrl"] = objUrl;

            if (!string.IsNullOrWhiteSpace(error))
                updates["Error"] = error;

            if (!string.IsNullOrWhiteSpace(status) && status == "running")
                updates["StartedAt"] = Timestamp.GetCurrentTimestamp();

            if (!string.IsNullOrWhiteSpace(status) && (status == "complete" || status == "error"))
                updates["FinishedAt"] = Timestamp.GetCurrentTimestamp();

            if (updates.Count == 0)
                return true;

            docRef.UpdateAsync(updates).Wait();
            return true;
        }

        public bool DeleteScan(string projectId, string deviceId, string scanId)
        {
            var docRef = _db
                .Collection("projects")
                .Document(projectId)
                .Collection("devices")
                .Document(deviceId)
                .Collection("scans")
                .Document(scanId);

            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return false;

            docRef.DeleteAsync().Wait();
            return true;
        }
    }
}
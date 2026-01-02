using System.Security.Cryptography;
using System.Text;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Mvc;
using BetterPlacemaking.Models;

namespace BetterPlacemaking.Services
{
    public class DeviceService(FirestoreDb db) : ControllerBase
    {
        private readonly FirestoreDb _db = db;
        private const string collectionName = "devices";

        public List<Device> GetDevices()
        {
            var response = _db.Collection(collectionName).GetSnapshotAsync().Result.Documents
                .Select(doc => doc.ConvertTo<Device>())
                .ToList();

            return response;
        }

        public Device? GetDevice(string id)
        {
            var device = _db.Collection(collectionName).Document(id).GetSnapshotAsync().Result
                .ConvertTo<Device>();

            return device;
        }

        public Device? AddDevice(Device device)
        {
            var collection = _db.Collection(collectionName);

            if (!string.IsNullOrEmpty(device?.Id))
            {
                var docRef = collection.Document(device.Id);
                docRef.SetAsync(device).Wait();
                var added = docRef.GetSnapshotAsync().Result
                    .ConvertTo<Device>();
                return added;
            }

            var newDocRef = collection.AddAsync(device).Result;
            var created = newDocRef.GetSnapshotAsync().Result
                .ConvertTo<Device>();
            return created;
        }

        public Device? UpdateDevice(string id, Device device)
        {
            var docRef = _db.Collection(collectionName).Document(id);

            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return null;

            var existing = snap.ConvertTo<Device>();
			device.ApiKeyHash = existing.ApiKeyHash;
            docRef.SetAsync(device).Wait();
            var updated = docRef.GetSnapshotAsync().Result
                .ConvertTo<Device>();
            return updated;
        }

        public Device? GetDeviceByApiKey(string apiKey)
        {
            var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(apiKey));
            var hash = Convert.ToBase64String(hashBytes);

            var query = _db.Collection(collectionName)
                .WhereEqualTo(nameof(Device.ApiKeyHash), hash)
                .Limit(1);

            var snapshot = query.GetSnapshotAsync().Result;
            var doc = snapshot.Documents.FirstOrDefault();
            return doc?.ConvertTo<Device>();
        }

        public string? GenerateAndUpdateApiKey(string id)
        {
            var docRef = _db.Collection(collectionName).Document(id);
            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return null;

            var device = snap.ConvertTo<Device>();
            if (device == null)
                return null;

            var newKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
            var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(newKey));
            var hash = Convert.ToBase64String(hashBytes);
            device.ApiKeyHash = hash;
            docRef.SetAsync(device).Wait();
            return newKey;
        }

        public bool DeleteDevice(string id)
        {
            var docRef = _db.Collection(collectionName).Document(id);
            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return false;

            docRef.DeleteAsync().Wait();
            return true;
        }
    }
}
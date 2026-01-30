using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Google.Cloud.Firestore;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Mvc;
using BetterPlacemaking.Models;
using BetterPlacemaking.Models.JetsonDTOs;

namespace BetterPlacemaking.Services
{
    public class DeviceService(FirestoreDb db, IDistributedCache cache, ILogger<DeviceService> logger) : ControllerBase
    {
        private readonly FirestoreDb _db = db;
        private readonly IDistributedCache _cache = cache;
        private readonly ILogger<DeviceService> _logger = logger;
        private const string collectionName = "devices";

        private static readonly TimeSpan BadApiKeyTtl = TimeSpan.FromMinutes(5);
        private static readonly TimeSpan GoodApiKeyTtl = TimeSpan.FromDays(7);

        private const string CachePrefix = "deviceapikey";

        private static string ComputeApiKeyHashBase64(string apiKey)
        {
            var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(apiKey));
            return Convert.ToBase64String(hashBytes);
        }

        private static bool TryGetCacheSuffixFromHashBase64(string apiKeyHashBase64, out string suffix)
        {
            suffix = string.Empty;
            if (string.IsNullOrWhiteSpace(apiKeyHashBase64))
                return false;

            try
            {
                var bytes = Convert.FromBase64String(apiKeyHashBase64);
                suffix = Convert.ToHexString(bytes);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static string GoodCacheKey(string suffix) => $"{CachePrefix}:good:{suffix}";
        private static string BadCacheKey(string suffix) => $"{CachePrefix}:bad:{suffix}";

        private void InvalidateApiKeyHash(string? apiKeyHashBase64)
        {
            if (string.IsNullOrWhiteSpace(apiKeyHashBase64))
                return;

            if (!TryGetCacheSuffixFromHashBase64(apiKeyHashBase64, out var suffix))
                return;

            _cache.Remove(GoodCacheKey(suffix));
            _cache.Remove(BadCacheKey(suffix));
        }

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
			device.HealthReport = existing.HealthReport;
            docRef.SetAsync(device).Wait();
            var updated = docRef.GetSnapshotAsync().Result
                .ConvertTo<Device>();

            // Ensure devices receive config updates without extra Firestore reads.
            if (!string.IsNullOrWhiteSpace(existing.ApiKeyHash))
            {
                InvalidateApiKeyHash(existing.ApiKeyHash);

                if (TryGetCacheSuffixFromHashBase64(existing.ApiKeyHash, out var suffix) && updated != null)
                {
                    _cache.SetString(
                        GoodCacheKey(suffix),
                        JsonSerializer.Serialize(updated),
                        new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = GoodApiKeyTtl }
                    );
                }
            }

            return updated;
        }

        public Device? GetDeviceByApiKey(string apiKey)
        {
            if (string.IsNullOrWhiteSpace(apiKey))
                return null;

            var hashBase64 = ComputeApiKeyHashBase64(apiKey);
            if (!TryGetCacheSuffixFromHashBase64(hashBase64, out var suffix))
                return GetDeviceByApiKeyFromDb(hashBase64);

            var badMarker = _cache.GetString(BadCacheKey(suffix));
            if (!string.IsNullOrWhiteSpace(badMarker))
                return null;

            var cached = _cache.GetString(GoodCacheKey(suffix));
            if (!string.IsNullOrWhiteSpace(cached))
            {
                try
                {
                    var device = JsonSerializer.Deserialize<Device>(cached);
                    if (device != null)
                        return device;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to deserialize cached device for API key hash suffix {Suffix}", suffix);
                    _cache.Remove(GoodCacheKey(suffix));
                }
            }

            var fromDb = GetDeviceByApiKeyFromDb(hashBase64);
            if (fromDb == null)
            {
                _cache.SetString(
                    BadCacheKey(suffix),
                    "1",
                    new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = BadApiKeyTtl }
                );
                return null;
            }

            _cache.Remove(BadCacheKey(suffix));
            _cache.SetString(
                GoodCacheKey(suffix),
                JsonSerializer.Serialize(fromDb),
                new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = GoodApiKeyTtl }
            );

            return fromDb;
        }

        private Device? GetDeviceByApiKeyFromDb(string apiKeyHashBase64)
        {
            var query = _db.Collection(collectionName)
                .WhereEqualTo(nameof(Device.ApiKeyHash), apiKeyHashBase64)
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

            var oldHash = device.ApiKeyHash;

            var newKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
            var hash = ComputeApiKeyHashBase64(newKey);
            device.ApiKeyHash = hash;
            docRef.SetAsync(device).Wait();

            // Invalidate old key immediately; prime cache for the new key.
            InvalidateApiKeyHash(oldHash);
            InvalidateApiKeyHash(hash);

            if (TryGetCacheSuffixFromHashBase64(hash, out var suffix))
            {
                _cache.SetString(
                    GoodCacheKey(suffix),
                    JsonSerializer.Serialize(device),
                    new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = GoodApiKeyTtl }
                );
            }

            return newKey;
        }

        public bool DeleteDevice(string id)
        {
            var docRef = _db.Collection(collectionName).Document(id);
            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return false;

            var existing = snap.ConvertTo<Device>();

            docRef.DeleteAsync().Wait();

            InvalidateApiKeyHash(existing?.ApiKeyHash);
            return true;
        }

        public Config? UpdateDeviceHealthReport(string deviceId, HealthReport healthReport)
        {
            var docRef = _db.Collection(collectionName).Document(deviceId);
            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return null;

            var device = snap.ConvertTo<Device>();
            if (device == null)
                return null;

            device.Config ??= new Config();

            var existingTracking = device.Config.TrackingCameras ?? [];
            var existingByNorm = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            foreach (var kvp in existingTracking)
            {
                var norm = NormalizeMac(kvp.Key);
                if (string.IsNullOrWhiteSpace(norm))
                    continue;

                if (!existingByNorm.ContainsKey(norm))
                    existingByNorm[norm] = kvp.Value;
            }

            var reportMacs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (healthReport?.Cameras != null)
            {
                foreach (var kvp in healthReport.Cameras)
                {
                    var mac = NormalizeMac(kvp.Value?.Mac);
                    if (string.IsNullOrWhiteSpace(mac))
                        mac = NormalizeMac(kvp.Key);

                    if (!string.IsNullOrWhiteSpace(mac))
                        reportMacs.Add(mac);
                }
            }

            var mergedTracking = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            foreach (var mac in reportMacs)
            {
                if (existingByNorm.TryGetValue(mac, out var existingValue))
                    mergedTracking[mac] = existingValue;
                else
                    mergedTracking[mac] = false;
            }

            device.Config.TrackingCameras = mergedTracking;
            device.HealthReport = healthReport;

            docRef.UpdateAsync(new Dictionary<string, object>
            {
                { nameof(Device.HealthReport), device.HealthReport! },
                { nameof(Device.Config), device.Config! }
            }).Wait();

            return device.Config;
        }

        private static string NormalizeMac(string? mac)
        {
            return (mac ?? string.Empty).Trim().ToLowerInvariant();
        }
    }
}
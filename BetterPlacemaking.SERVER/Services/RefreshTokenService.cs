using System.Security.Cryptography;
using System.Text;
using BetterPlacemaking.Models;
using Google.Cloud.Firestore;
using Microsoft.Extensions.Configuration;

namespace BetterPlacemaking.Services
{
    public sealed class RefreshTokenService(FirestoreDb db, IConfiguration config)
    {
        private const string CollectionName = "refreshTokens";
        private const int DefaultRefreshTokenBytes = 64;

        private readonly FirestoreDb _db = db;
        private readonly IConfiguration _config = config;

        public int RefreshTokenDays => int.TryParse(_config["Auth:RefreshTokenDays"], out var days) ? days : 30;

        public async Task<(string RefreshToken, DateTime ExpiresAtUtc, string TokenId)> IssueAsync(
            string userId,
            string? userAgent,
            CancellationToken cancellationToken = default)
        {
            var refreshToken = GenerateRefreshToken();
            var tokenHash = ComputeTokenHash(refreshToken);

            var now = DateTime.UtcNow;
            var expires = now.AddDays(RefreshTokenDays);

            var docRef = _db.Collection(CollectionName).Document();
            var record = new RefreshTokenRecord
            {
                UserId = userId,
                TokenHash = tokenHash,
                CreatedAtUtc = now,
                ExpiresAtUtc = expires,
                RevokedAtUtc = null,
                ReplacedByTokenId = null,
                UserAgent = userAgent
            };

            await docRef.SetAsync(record, cancellationToken: cancellationToken);
            return (refreshToken, expires, docRef.Id);
        }

        public async Task<RefreshTokenRecord?> FindActiveAsync(string refreshToken, CancellationToken cancellationToken = default)
        {
            var tokenHash = ComputeTokenHash(refreshToken);

            var snapshot = await _db.Collection(CollectionName)
                .WhereEqualTo(nameof(RefreshTokenRecord.TokenHash), tokenHash)
                .Limit(1)
                .GetSnapshotAsync(cancellationToken);

            var doc = snapshot.Documents.FirstOrDefault();
            if (doc == null)
                return null;

            var record = doc.ConvertTo<RefreshTokenRecord>();
            record.Id ??= doc.Id;

            if (record.RevokedAtUtc != null)
                return null;

            if (record.ExpiresAtUtc <= DateTime.UtcNow)
                return null;

            return record;
        }

        public async Task RevokeAsync(string tokenId, string? replacedByTokenId = null, CancellationToken cancellationToken = default)
        {
            var docRef = _db.Collection(CollectionName).Document(tokenId);
            var updates = new Dictionary<string, object?>
            {
                { nameof(RefreshTokenRecord.RevokedAtUtc), DateTime.UtcNow },
                { nameof(RefreshTokenRecord.ReplacedByTokenId), replacedByTokenId }
            };

            await docRef.UpdateAsync(updates, cancellationToken: cancellationToken);
        }

        public string ComputeTokenHash(string refreshToken)
        {
            // HMAC is preferred; fallback to Jwt:Key to avoid needing a second secret.
            var key = _config["Auth:RefreshTokenHashKey"]
                      ?? _config["Jwt:Key"]
                      ?? throw new InvalidOperationException("Missing Auth:RefreshTokenHashKey (or Jwt:Key fallback)");

            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(key));
            var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(refreshToken));
            return Convert.ToBase64String(hash);
        }

        private static string GenerateRefreshToken()
        {
            var bytes = RandomNumberGenerator.GetBytes(DefaultRefreshTokenBytes);
            return Base64UrlEncode(bytes);
        }

        private static string Base64UrlEncode(byte[] bytes)
        {
            var s = Convert.ToBase64String(bytes);
            s = s.Replace('+', '-').Replace('/', '_');
            return s.TrimEnd('=');
        }
    }
}

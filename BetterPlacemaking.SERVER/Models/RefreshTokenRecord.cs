using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models
{
    [FirestoreData]
    public sealed class RefreshTokenRecord
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? UserId { get; set; }

        [FirestoreProperty]
        public string? TokenHash { get; set; }

        [FirestoreProperty]
        public DateTime CreatedAtUtc { get; set; }

        [FirestoreProperty]
        public DateTime ExpiresAtUtc { get; set; }

        [FirestoreProperty]
        public DateTime? RevokedAtUtc { get; set; }

        [FirestoreProperty]
        public string? ReplacedByTokenId { get; set; }

        [FirestoreProperty]
        public string? UserAgent { get; set; }
    }
}

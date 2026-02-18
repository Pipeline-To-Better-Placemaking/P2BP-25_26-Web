using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models
{
    [FirestoreData]
    public sealed class Media
    {
        [FirestoreDocumentId]
        public required string Id { get; set; }

        [FirestoreProperty]
        public required string Name { get; set; }

        [FirestoreProperty]
        public required string PathFromRoot { get; set; }

        [FirestoreProperty]
        public required string Extension { get; set; }

        [FirestoreProperty]
        public required DateTime UploadedAtUtc { get; set; }
    }
}

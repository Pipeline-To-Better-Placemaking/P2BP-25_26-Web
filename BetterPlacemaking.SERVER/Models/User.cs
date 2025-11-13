using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models
{
    [FirestoreData]
    public class User
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? FirstName { get; set; }

        [FirestoreProperty]
        public string? LastName { get; set; }
    }
}
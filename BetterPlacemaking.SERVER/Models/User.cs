using System.Text.Json.Serialization;
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

        [FirestoreProperty]
        public string? Email { get; set; }

        [FirestoreProperty]
        [JsonIgnore]
        public string? Password { get; set; }

        [FirestoreProperty]
        [JsonIgnore]
        public string? Role { get; set; }

        [FirestoreProperty]
        [JsonIgnore]
        public bool EmailVerified { get; set; } = false;

        [FirestoreProperty]
        [JsonIgnore]
        public string? EmailVerificationToken { get; set; }
    }   
}
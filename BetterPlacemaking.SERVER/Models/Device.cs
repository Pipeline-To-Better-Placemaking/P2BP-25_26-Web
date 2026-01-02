using System.Text.Json.Serialization;
using Google.Cloud.Firestore;
using BetterPlacemaking.Models.JetsonDTOs;

namespace BetterPlacemaking.Models
{
    [FirestoreData]
    public class Device
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? ProjectId { get; set; }

        [FirestoreProperty]
        public string? Name { get; set; }

        [FirestoreProperty]
        public Config? Config { get; set; }

        [FirestoreProperty]
        [JsonIgnore]
        public string? ApiKeyHash { get; set; }
    }
}
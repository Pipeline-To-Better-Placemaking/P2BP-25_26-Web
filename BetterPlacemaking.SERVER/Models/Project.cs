using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models
{
    [FirestoreData]
    public class Project
    {
        [FirestoreDocumentId]
        public string? Id { get; set; }

        [FirestoreProperty]
        public string? Title { get; set; }

        [FirestoreProperty]
        public string? Description { get; set; }

        [FirestoreProperty]
        public string? Location { get; set; }
    }

    public class ProjectRequest
    {
        public string? Title { get; set; }
        public string? Description { get; set; }
        public string? Location { get; set; }
    }
}
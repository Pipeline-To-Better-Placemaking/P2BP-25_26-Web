using BetterPlacemaking.Models;
using Google.Cloud.Firestore;

namespace BetterPlacemaking.Services
{
    public class ProjectService(FirestoreDb db)
    {
        private readonly FirestoreDb _db = db;
        private const string collectionName = "projects";

        public List<Project> GetAll()
        {
            var projects = _db.Collection(collectionName).GetSnapshotAsync().Result.Documents
                .Select(doc => doc.ConvertTo<Project>())
                .ToList();
            
            return projects;
        }
        
        public Project? GetById(string id)
        {
            if (string.IsNullOrEmpty(id))
            {
                return null;
            }
            
            var project = _db.Collection(collectionName).Document(id).GetSnapshotAsync().Result
                .ConvertTo<Project>();

            return project;
        }

        public Project Create(Project project)
        {
            var docRef = _db.Collection(collectionName).Document();
            project.Id = docRef.Id;
            docRef.SetAsync(project).Wait();
            return project;
        }

        public bool Update(Project project)
        {
            if (string.IsNullOrEmpty(project.Id))
                return false;

            var docRef = _db.Collection(collectionName).Document(project.Id);

            var snapshot = docRef.GetSnapshotAsync().Result;
            if (!snapshot.Exists)
                return false;

            docRef.UpdateAsync(new Dictionary<string, object>
            {
                { "Title", project.Title! },
                { "Description", project.Description! },
                { "Location", project.Location! }
            }).Wait();

            return true;
        }

        public bool Delete(string projectId)
        {
            var docRef = _db.Collection(collectionName).Document(projectId);

            var snapshot = docRef.GetSnapshotAsync().Result;
            if (!snapshot.Exists)
            {
                return false;
            }

            docRef.DeleteAsync().Wait();
            return true;
        }
    }
}

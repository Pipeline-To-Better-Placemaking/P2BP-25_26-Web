using BetterPlacemaking.Models;
using Google.Cloud.Firestore;

namespace BetterPlacemaking.Services
{
    public class AdminService(FirestoreDb db)
    {
        private readonly FirestoreDb _db = db;

        public bool UpdateRole(string targetEmail, string newRole)
        {
            newRole = newRole.Trim();

            var users = _db.Collection("users");

            var targetResult = users.WhereEqualTo("Email", targetEmail).GetSnapshotAsync().Result;

            if (targetResult.Count == 0)
                return false;

            var targetDoc = targetResult.Documents[0];
            var targetUser = targetDoc.ConvertTo<User>();

            if (targetUser.Role == "Admin")
            {
                return false;
            }
            
            if (targetUser.Role == newRole)
            {    
                return true;
            }

            targetDoc.Reference.UpdateAsync(new Dictionary<string, object>
            {
                { 
                    "Role", newRole 
                }
            }).Wait();

            return true;
        }
    }
}

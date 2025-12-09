using BetterPlacemaking.Models;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Mvc;
using BCrypt.Net;

namespace BetterPlacemaking.Services
{
    public class UserService(FirestoreDb db)
    {
        private readonly FirestoreDb _db = db;
        private const string collectionName = "users";

        public List<User> GetUsers()
        {
            var response = _db.Collection(collectionName).GetSnapshotAsync().Result.Documents
                .Select(doc => doc.ConvertTo<User>())
                .ToList();
            return response;
        }

        public User? GetUser(string id)
        {
            var user = _db.Collection(collectionName).Document(id).GetSnapshotAsync().Result
                .ConvertTo<User>();

            return user;
        }

        public async Task<User?> AddUser(User user)
        {
            var collection = _db.Collection(collectionName);

            var query = collection.WhereEqualTo("Email", user.Email);
            var result = await query.GetSnapshotAsync();
            if (result.Count > 0)
            {
                return null;
            }

            user.Password = BCrypt.Net.BCrypt.HashPassword(user.Password);

            user.Role = "User";

            var docRef = string.IsNullOrWhiteSpace(user.Id)
                ? collection.Document()
                : collection.Document(user.Id);

            await docRef.SetAsync(user);

            var userInfo = new User
            {
                FirstName = user.FirstName,
                LastName = user.LastName,
                Email = user.Email,
                Role = user.Role
            };
            
            return userInfo;
        }

        public User? UpdateUser(string id, User user)
        {
            var docRef = _db.Collection(collectionName).Document(id);

            docRef.SetAsync(user).Wait();

            var updated = docRef.GetSnapshotAsync().Result
                .ConvertTo<User>();
            return updated;
        }

        public bool DeleteUser(string id)
        {
            var docRef = _db.Collection(collectionName).Document(id);
            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return false;

            docRef.DeleteAsync().Wait();
            return true;
        }
    }
}
using BetterPlacemaking.Models;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Services
{
    public class UserService(FirestoreDb db) : ControllerBase
    {
        private readonly FirestoreDb _db = db;

        public List<User> GetUsers()
        {
            var response = _db.Collection("users").GetSnapshotAsync().Result.Documents.Select(doc => doc.ConvertTo<User>()).ToList();
            return response;
        }
    }
}
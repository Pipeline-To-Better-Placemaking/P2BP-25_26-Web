using BetterPlacemaking.Models;
using Google.Cloud.Firestore;

namespace BetterPlacemaking.Services
{
    public class LoginService(FirestoreDb db)
    {
        private readonly FirestoreDb _db = db;
        private const string collectionName = "users";

        public LoginResponse Login(string email, string password)
        {
            var query = _db.Collection("users").WhereEqualTo("Email", email);

            var result = query.GetSnapshotAsync().Result;

            if (result.Count == 0)
            {
                return new LoginResponse
                {
                    Success = false,
                    Message = "User does not exist"
                };
            }
            
            var user = result.Documents[0].ConvertTo<User>();

            if (user.Password != password)
            {
                return new LoginResponse
                {
                    Success = false,
                    Message = "Wrong password"
                };
            }

            return new LoginResponse
            {
                Success = true,
                Message = "Login successful",
                User = user
            };
    }

    }
}

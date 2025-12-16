using BetterPlacemaking.Models;
using Google.Cloud.Firestore;


namespace BetterPlacemaking.Services
{
    public class LoginService(FirestoreDb db)
    {
        private readonly FirestoreDb _db = db;

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
            bool correctPass = BCrypt.Net.BCrypt.Verify(password, user.Password);

            if (!correctPass)
            {
                return new LoginResponse
                {
                    Success = false,
                    Message = "Wrong password"
                };
            }
            
            if (!user.EmailVerified)
            {
                return new LoginResponse
                {
                    Success = false,
                    Message = "Email not verified. Please check your email."
                };
            }

            var userInfo = new User
            {
                FirstName = user.FirstName,
                LastName = user.LastName,
                Email = user.Email,
                Role = user.Role
            };

            return new LoginResponse
            {
                Success = true,
                Message = "Login successful",
                User = userInfo
            };
    }

    }
}

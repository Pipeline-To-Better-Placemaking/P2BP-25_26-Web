using BetterPlacemaking.Models;
using Google.Cloud.Firestore;


namespace BetterPlacemaking.Services
{
    public class PasswordService(FirestoreDb db, EmailService emailService)
    {
        private readonly FirestoreDb _db = db;
        private readonly EmailService _emailService = emailService;
        private const string collectionName = "users";


        public bool RequestPasswordReset(string email)
        {
            var query = _db.Collection(collectionName).WhereEqualTo("Email", email);
            var result = query.GetSnapshotAsync().Result;

            if (result.Count == 0) return false;

            var doc = result.Documents[0];
            var user = doc.ConvertTo<User>();

            var token = Guid.NewGuid().ToString();
            var expiry = DateTime.UtcNow.AddHours(1);

            var updates = new Dictionary<string, object>
            {
                { "PasswordResetToken", token },
                { "PasswordResetTokenExpiry", expiry }
            };

            doc.Reference.UpdateAsync(updates).Wait();

            _emailService.SendEmail(email, token, "Password Reset");

            return true;
        }

        public bool ResetPassword(string token, string newPassword)
        {
            var query = _db.Collection(collectionName)
                .WhereEqualTo("PasswordResetToken", token);

            var result = query.GetSnapshotAsync().Result;
            if (result.Count == 0) return false;

            var doc = result.Documents[0];
            var user = doc.ConvertTo<User>();

            if (user.PasswordResetTokenExpiry == null || user.PasswordResetTokenExpiry < DateTime.UtcNow)
                return false;

            var hashedPassword = BCrypt.Net.BCrypt.HashPassword(newPassword);
            var updates = new Dictionary<string, object?>
            {
                { "Password", hashedPassword },
                { "PasswordResetToken", null },
                { "PasswordResetTokenExpiry", null }
            };

            doc.Reference.UpdateAsync(updates).Wait();
            return true;
        }
    }
}

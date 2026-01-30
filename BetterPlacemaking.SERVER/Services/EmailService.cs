using Mailjet.Client;
using Mailjet.Client.Resources;
using Newtonsoft.Json.Linq;

namespace BetterPlacemaking.Services
{
    public class EmailService()
    {
        private readonly string _apiKey = Environment.GetEnvironmentVariable("MAILJET_KEY")!;
        private readonly string _apiSecret = Environment.GetEnvironmentVariable("SECRET_KEY")!;

        public void SendEmail(string toEmail, string token, string subject = "Verify your email")
        {
            var client = new MailjetClient(_apiKey, _apiSecret);

            string link = subject == "Password Reset"
                ? $"http://localhost:5123/api/password/reset-password?token={token}"
                : $"http://localhost:5123/api/email/verify-email?token={token}";

            var request = new MailjetRequest
            {
                Resource = Send.Resource,
            }
            .Property(Send.FromEmail, "lanzzhen@gmail.com")
            .Property(Send.FromName, "BetterPlacemaking")
            .Property(Send.Subject, subject)
            .Property(Send.HtmlPart, $"<p>Click to proceed:</p><a href='{link}'>{subject}</a>")
            .Property(Send.Recipients, new JArray { new JObject { { "Email", toEmail } } });

            var response = client.PostAsync(request).Result;
        }
    }
}
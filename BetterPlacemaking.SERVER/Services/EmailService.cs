using Mailjet.Client;
using Mailjet.Client.Resources;
using Newtonsoft.Json.Linq;

public class EmailService
{
    private readonly string _apiKey;
    private readonly string _apiSecret;

    public EmailService()
    {
        _apiKey = Environment.GetEnvironmentVariable("MAILJET_KEY")!;
        _apiSecret = Environment.GetEnvironmentVariable("SECRET_KEY")!;
    }

    public void SendVerificationEmail(string toEmail, string token)
    {
        var client = new MailjetClient(_apiKey, _apiSecret);

        var request = new MailjetRequest
        {
            Resource = Send.Resource,
        }
        .Property(Send.FromEmail, "lanzzhen@gmail.com")
        .Property(Send.FromName, "BetterPlacemaking")
        .Property(Send.Subject, "Verify your email")
        .Property(Send.HtmlPart, $"<p>Click to verify your email:</p><a href='http://localhost:5123/api/email/verify-email?token={token}'>Verify Email</a>")
        .Property(Send.Recipients, new JArray {
            new JObject { { "Email", toEmail } }
        });

        var response = client.PostAsync(request).Result;
    }
}

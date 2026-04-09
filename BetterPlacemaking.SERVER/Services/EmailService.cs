using Mailjet.Client;
using Mailjet.Client.Resources;
using Newtonsoft.Json.Linq;
using System.Net;

namespace BetterPlacemaking.Services
{
    public class EmailService(IConfiguration config, ILogger<EmailService> logger)
    {
        private readonly IConfiguration _config = config;
        private readonly ILogger<EmailService> _logger = logger;

        public void SendEmail(string toEmail, string token, string subject = "Verify your email")
        {
            if (string.Equals(subject, "Password Reset", StringComparison.OrdinalIgnoreCase))
            {
                SendPasswordResetEmail(toEmail, token);
                return;
            }

            SendVerificationEmail(toEmail, token);
        }

        public void SendVerificationEmail(string toEmail, string token)
        {
            var apiBaseUrl = ResolveApiBaseUrl();
            var link = $"{apiBaseUrl}/api/email/verify-email?token={Uri.EscapeDataString(token)}";
            SendHtmlEmail(toEmail, "Verify your email",
                $"""
                 <p>Welcome to BetterPlacemaking.</p>
                 <p>Please verify your email to activate your account:</p>
                 <p><a href="{WebUtility.HtmlEncode(link)}">Verify Email</a></p>
                 """
            );
        }

        public void SendPasswordResetEmail(string toEmail, string token)
        {
            var apiBaseUrl = ResolveApiBaseUrl();
            var link = $"{apiBaseUrl}/api/password/reset-password?token={Uri.EscapeDataString(token)}";
            SendHtmlEmail(toEmail, "Password Reset",
                $"""
                 <p>We received a password reset request.</p>
                 <p>Use this link to reset your password:</p>
                 <p><a href="{WebUtility.HtmlEncode(link)}">Reset Password</a></p>
                 """
            );
        }

        public void SendScanCompletedEmail(string toEmail, string projectName, DateTime completedAtUtc, string resultUrl)
        {
            SendNotificationEmail(
                toEmail,
                "Scan Completed",
                "Scan Completed",
                projectName,
                completedAtUtc,
                resultUrl
            );
        }

        private void SendNotificationEmail(
            string toEmail,
            string subject,
            string notificationType,
            string projectName,
            DateTime completedAtUtc,
            string resultUrl)
        {
            var safeType = WebUtility.HtmlEncode(notificationType);
            var safeProject = WebUtility.HtmlEncode(projectName);
            var safeTime = WebUtility.HtmlEncode(completedAtUtc.ToString("u"));
            var safeUrl = WebUtility.HtmlEncode(resultUrl);

            SendHtmlEmail(toEmail, subject,
                $"""
                 <p><strong>Notification Type:</strong> {safeType}</p>
                 <p><strong>Project:</strong> {safeProject}</p>
                 <p><strong>Timestamp (UTC):</strong> {safeTime}</p>
                 <p><a href="{safeUrl}">View results</a></p>
                 """
            );
        }

        private void SendHtmlEmail(string toEmail, string subject, string htmlPart)
        {
            if (string.IsNullOrWhiteSpace(toEmail))
                return;

            var client = CreateClient();
            if (client == null)
                return;

            var fromEmail = _config["Mailjet:FromEmail"] ?? "lanzzhen@gmail.com";
            var fromName = _config["Mailjet:FromName"] ?? "BetterPlacemaking";

            var request = new MailjetRequest
            {
                Resource = Send.Resource,
            }
            .Property(Send.FromEmail, fromEmail)
            .Property(Send.FromName, fromName)
            .Property(Send.Subject, subject)
            .Property(Send.HtmlPart, htmlPart)
            .Property(Send.Recipients, new JArray { new JObject { { "Email", toEmail } } });

            var response = client.PostAsync(request).Result;
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Mailjet send failed. Status: {StatusCode}, Info: {Info}", response.StatusCode, response.GetData());
            }
        }

        private MailjetClient? CreateClient()
        {
            var apiKey =
                Environment.GetEnvironmentVariable("MAILJET_KEY")
                ?? _config["Mailjet:ApiKey"];
            var apiSecret =
                Environment.GetEnvironmentVariable("SECRET_KEY")
                ?? _config["Mailjet:ApiSecret"];

            if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(apiSecret))
            {
                _logger.LogWarning("MAILJET_KEY/SECRET_KEY are not configured. Skipping email send.");
                return null;
            }

            return new MailjetClient(apiKey, apiSecret);
        }

        private string ResolveApiBaseUrl()
        {
            return _config["ApiBaseUrl"]?.TrimEnd('/') ?? "http://localhost:5123";
        }
    }
}

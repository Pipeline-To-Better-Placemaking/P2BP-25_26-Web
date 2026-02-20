using BetterPlacemaking.Models;

namespace BetterPlacemaking.Services
{
    public class NotificationService(
        IConfiguration config,
        UserService userService,
        ProjectService projectService,
        EmailService emailService,
        ILogger<NotificationService> logger)
    {
        private readonly IConfiguration _config = config;
        private readonly UserService _userService = userService;
        private readonly ProjectService _projectService = projectService;
        private readonly EmailService _emailService = emailService;
        private readonly ILogger<NotificationService> _logger = logger;

        public void NotifyScanCompleted(string userId, string? projectId = null, string? projectName = null)
        {
            if (!TryResolveEligibleUser(userId, out var user))
                return;

            if (!(user!.ScanCompletionAlerts ?? false))
                return;

            var resolvedProjectName = ResolveProjectName(projectId, projectName);
            var resultUrl = ResolveResultUrl(projectId);

            _emailService.SendScanCompletedEmail(
                user.Email!,
                resolvedProjectName,
                DateTime.UtcNow,
                resultUrl
            );
        }

        public void NotifyChangeDetected(string userId, double changeAmount, string? projectId = null, string? projectName = null)
        {
            if (changeAmount <= 0)
                return;

            if (!TryResolveEligibleUser(userId, out var user))
                return;

            if (!(user!.ChangeDetectionAlerts ?? true))
                return;

            var resolvedProjectName = ResolveProjectName(projectId, projectName);
            var resultUrl = ResolveResultUrl(projectId);

            _emailService.SendChangeDetectedEmail(
                user.Email!,
                resolvedProjectName,
                DateTime.UtcNow,
                resultUrl
            );
        }

        private bool TryResolveEligibleUser(string userId, out User? user)
        {
            user = _userService.GetUser(userId);
            if (user == null)
                return false;

            if (string.IsNullOrWhiteSpace(user.Email))
                return false;

            if (!user.EmailVerified)
                return false;

            if (!(user.EmailAlerts ?? true))
                return false;

            return true;
        }

        private string ResolveProjectName(string? projectId, string? fallbackName)
        {
            if (!string.IsNullOrWhiteSpace(fallbackName))
                return fallbackName.Trim();

            if (!string.IsNullOrWhiteSpace(projectId))
            {
                try
                {
                    var project = _projectService.GetById(projectId);
                    if (!string.IsNullOrWhiteSpace(project?.Title))
                        return project.Title!;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to resolve project name for project id {ProjectId}", projectId);
                }
            }

            return "Project";
        }

        private string ResolveResultUrl(string? projectId)
        {
            var appBaseUrl = _config["Notifications:AppBaseUrl"]?.TrimEnd('/') ?? "http://localhost:4200";
            if (string.IsNullOrWhiteSpace(projectId))
                return $"{appBaseUrl}/projects";

            return $"{appBaseUrl}/{Uri.EscapeDataString(projectId)}/dashboard";
        }
    }
}

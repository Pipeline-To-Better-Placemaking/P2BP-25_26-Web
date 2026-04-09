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

        public void NotifyScanCompleted(string triggerUserId, string projectId, string? projectName = null, bool isScheduled = false)
        {
            var resolvedProjectName = ResolveProjectName(projectId, projectName);
            var resultUrl = ResolveResultUrl(projectId);

            _ = Task.Run(() =>
            {
                try
                {
                    var members = _userService.GetProjectMembersForNotification(projectId);

                    foreach (var member in members)
                    {
                        if (!member.EmailAlerts || !member.EmailVerified || string.IsNullOrWhiteSpace(member.Email))
                            continue;

                        bool shouldNotify;
                        if (isScheduled)
                        {
                            shouldNotify = member.NotifyOnScheduledScan;
                        }
                        else
                        {
                            shouldNotify = member.UserId == triggerUserId
                                ? member.NotifyOnOwnScan
                                : member.NotifyOnOthersScan;
                        }

                        if (shouldNotify)
                        {
                            _emailService.SendScanCompletedEmail(member.Email, resolvedProjectName, DateTime.UtcNow, resultUrl);
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to send scan notifications for project {ProjectId}", projectId);
                }
            });
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

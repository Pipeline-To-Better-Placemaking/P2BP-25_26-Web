namespace BetterPlacemaking.Models.Dtos
{
    public class ProjectRoleAssignmentDto
    {
        public string? ProjectId { get; set; }
        public string? ProjectName { get; set; }
        public List<string> Roles { get; set; } = [];
        public bool NotifyOnOwnScan { get; set; }
        public bool NotifyOnOthersScan { get; set; }
        public bool NotifyOnScheduledScan { get; set; }
        public bool NotifyOnSystemToggle { get; set; }
        public bool NotifyOnHealthAlert { get; set; }
        public bool EmailPdfOnSystemOff { get; set; }
    }

    public class UserProjectRoleAssignmentsDto
    {
        public string? UserId { get; set; }
        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public string? Email { get; set; }
        public List<ProjectRoleAssignmentDto> Assignments { get; set; } = [];
    }

    public class UserProjectRoleAssignmentsUpdateDto
    {
        public string? UserId { get; set; }
        public List<ProjectRoleAssignmentDto> Assignments { get; set; } = [];
    }

    public class ProjectMemberRoleDto
    {
        public string? UserId { get; set; }
        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public string? Email { get; set; }
        public string? Role { get; set; }
    }

    public class ProjectMemberRoleUpdateDto
    {
        public string? UserId { get; set; }
        public string? Role { get; set; }
    }
}

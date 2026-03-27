namespace BetterPlacemaking.Models.Dtos
{
    public class ProjectRoleAssignmentDto
    {
        public string? ProjectId { get; set; }
        public string? ProjectName { get; set; }
        public List<string> Roles { get; set; } = [];
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
}

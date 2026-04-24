using BetterPlacemaking.Models;
using BetterPlacemaking.Models.Dtos;
using BetterPlacemaking.Services;
using BetterPlacemaking.Authorization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ProjectController(
        ProjectService projectService,
        FirestoreAuthorizationDataService authorizationDataService) : ControllerBase
    {
        private readonly ProjectService _projectService = projectService;
        private readonly FirestoreAuthorizationDataService _authorizationDataService = authorizationDataService;

        private static ProjectDto ToDto(Project project) => new()
        {
            Id = project.Id,
            Title = project.Title,
            Description = project.Description,
            Location = project.Location,
        };

        private static Project FromDto(ProjectDto dto) => new()
        {
            Id = dto.Id,
            Title = dto.Title,
            Description = dto.Description,
            Location = dto.Location,
        };

        [HttpGet]
        [Authorize]
        public async Task<IActionResult> GetProjects(CancellationToken cancellationToken)
        {
            var userId = GetUserId();
            if (string.IsNullOrWhiteSpace(userId))
                return Unauthorized();

            var projects = await _projectService.GetAllAsync(cancellationToken);
            var canReadAll = await _authorizationDataService.HasGlobalPermissionFreshAsync(
                userId,
                User,
                Permissions.Global.Projects.ReadAll,
                cancellationToken);

            if (!canReadAll)
            {
                var readableChecks = projects
                    .Where(project => !string.IsNullOrWhiteSpace(project.Id))
                    .Select(async project => new
                    {
                        Project = project,
                        CanRead = await _authorizationDataService.HasProjectPermissionAsync(
                            userId,
                            project.Id!,
                            Permissions.Project.Read,
                            cancellationToken)
                    });

                projects = (await Task.WhenAll(readableChecks))
                    .Where(result => result.CanRead)
                    .Select(result => result.Project)
                    .ToList();
            }

            var dtos = projects.Select(ToDto).ToList();
            return Ok(dtos);
        }

        private string? GetUserId()
        {
            return User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);
        }


        [HttpGet("{id}")]
        [RequirePermission(Permissions.Project.Read)]
        public IActionResult GetProject([FromRoute] string id)
        {
            var project = _projectService.GetById(id);
            if (project == null)
            {
                return NotFound();
            }

            return Ok(ToDto(project));
        }

        [HttpPost]
        [RequirePermission(Permissions.Global.Projects.Create)]
        public IActionResult CreateProject([FromBody] ProjectRequest request)
        {
            var project = new Project
            {
                Title = request.Title,
                Description = request.Description,
                Location = request.Location
            };

            _projectService.Create(project);

            return Ok(ToDto(project));
        }

        [HttpPut("{id}")]
        [RequirePermission(Permissions.Project.Update)]
        public IActionResult UpdateProject(string id, [FromBody] Project request)
        {
            if (request == null)
                return BadRequest();

            request.Id = id;
            var success = _projectService.Update(request);

            if (!success)
                return NotFound();

            return Ok();
        }

        [HttpDelete("{id}")]
        [RequirePermission(Permissions.Project.Delete)]
        public IActionResult DeleteProject(string id)
        {
            var success = _projectService.Delete(id);

            if (!success)
                return NotFound();

            return Ok();
        }
    }
}

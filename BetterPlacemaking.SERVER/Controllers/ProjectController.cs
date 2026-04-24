using BetterPlacemaking.Models;
using BetterPlacemaking.Models.Dtos;
using BetterPlacemaking.Services;
using BetterPlacemaking.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ProjectController(ProjectService projectService) : ControllerBase
    {
        private readonly ProjectService _projectService = projectService;

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
        [RequirePermission(Permissions.Global.Projects.ReadAll)]
        public IActionResult GetProjects()
        {
            var projects = _projectService.GetAll();
            var dtos = projects.Select(ToDto).ToList();
            return Ok(dtos);
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

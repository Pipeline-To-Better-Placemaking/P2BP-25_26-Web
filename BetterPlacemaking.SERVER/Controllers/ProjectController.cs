using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ProjectController(ProjectService projectService) : ControllerBase
    {
        private readonly ProjectService _projectService = projectService;

        [HttpPost("create")]
        [Authorize(Roles = "Admin")]
        public IActionResult CreateProject([FromBody] ProjectRequest request)
        {
            var project = new Project
            {
                Title = request.Title,
                Description = request.Description,
                Size = request.Size,
                Location = request.Location
            };

            _projectService.Create(project);

            return Ok(new
            {
                Success = true,
                Message = "Project created successfully",
                Project = project
            });
        }

        [HttpPut("update")]
        [Authorize(Roles = "Admin")]
        public IActionResult UpdateProject([FromBody] Project request)
        {
            var success = _projectService.Update(request);

            if (!success)
            {
                return NotFound("Project not found");
            }

            return Ok("Project updated successfully");
        }

        [HttpDelete("delete")]
        [Authorize(Roles = "Admin")]
        public IActionResult DeleteProject(string id)
        {
            var success = _projectService.Delete(id);

            if (!success){
                return NotFound("Project not found");
            }

            return Ok("Project deleted successfully");
        }
    }
}

using BetterPlacemaking.Services;
using BetterPlacemaking.Models;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using BetterPlacemaking.Models.Dtos;

namespace BetterPlacemaking.Controllers
{
	[ApiController]
	[Route("api/[controller]")]
	[Authorize(Policy = "UserJwt")]
	public class UserController(UserService userService) : ControllerBase
	{
		private readonly UserService _userService = userService;

		[HttpGet]
		public IActionResult GetUsers()
		{
			try
			{
				var response = _userService.GetUsers();
				return Ok(response);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while retrieving users.");
			}
		}

		[HttpGet("{id}")]
		public IActionResult GetUser(string id)
		{
			try
			{
				var response = _userService.GetUser(id);
				if (response == null)
					return NotFound();
				return Ok(response);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while retrieving the user.");
			}
		}

		[HttpPost]
		public IActionResult AddUser([FromBody] User user)
		{
			if (user == null)
				return BadRequest();

			try
			{
				var created = _userService.AddUser(user);
				return CreatedAtAction(nameof(GetUser), new { id = created?.Id }, created);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while adding the user.");
			}
		}

		[HttpPut("{id}")]
		public IActionResult UpdateUser(string id, [FromBody] User user)
		{
			if (user == null || id != user.Id)
				return BadRequest();

			try
			{
				var updated = _userService.UpdateUser(id, user);
				if (updated == null)
					return NotFound();
				return Ok(updated);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while updating the user.");
			}
		}

		[HttpDelete("{id}")]
		public IActionResult DeleteUser(string id)
		{
			try
			{
				var deleted = _userService.DeleteUser(id);
				if (!deleted)
					return NotFound();
				return NoContent();
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while deleting the user.");
			}
		}

		[HttpPatch("me/settings")]
		public IActionResult UpdateMySettings([FromBody] UserSettingsDto dto)
		{
			try
			{
				var userId = ResolveCurrentUserId();
				
				if (string.IsNullOrWhiteSpace(userId))
					return Unauthorized("Missing user id claim.");
					
				_userService.UserSettings(userId, dto);
        		return NoContent();
}
    	catch (Exception)
    	{
        	return Problem("An unexpected error occurred while updating user settings.");
    	}
	}

		[HttpGet("me/settings")]
		public IActionResult GetMySettings()
		{
			try
			{
				var userId = ResolveCurrentUserId();
				if (string.IsNullOrWhiteSpace(userId))
					return Unauthorized("Missing user id claim.");

				var settings = _userService.GetUserSettings(userId);
				if (settings == null)
					return NotFound();

				return Ok(settings);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while retrieving user settings.");
			}
		}

		[HttpGet("project-roles/options")]
		public IActionResult GetProjectRoleOptions()
		{
			try
			{
				var response = _userService.GetProjectRoleOptions();
				return Ok(response);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while retrieving project role options.");
			}
		}

		[HttpGet("project-roles")]
		public IActionResult GetProjectRoles()
		{
			try
			{
				var response = _userService.GetProjectRoleAssignments();
				return Ok(response);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while retrieving project role assignments.");
			}
		}

		[HttpPut("project-roles")]
		public IActionResult SetProjectRoles([FromBody] UserProjectRoleAssignmentsUpdateDto request)
		{
			if (request == null || string.IsNullOrWhiteSpace(request.UserId))
				return BadRequest("UserId is required.");

			try
			{
				var success = _userService.SetUserProjectRoleAssignments(request);
				if (!success)
					return NotFound("User not found.");

				return NoContent();
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while updating project role assignments.");
			}
		}

		[HttpGet("project-roles/project/{projectId}")]
		public IActionResult GetProjectRolesForProject([FromRoute] string projectId)
		{
			if (string.IsNullOrWhiteSpace(projectId))
				return BadRequest("ProjectId is required.");

			try
			{
				var response = _userService.GetProjectMemberRoles(projectId);
				return Ok(response);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while retrieving project role assignments.");
			}
		}

		[HttpPut("project-roles/project/{projectId}")]
		public IActionResult SetProjectRoleForProject([FromRoute] string projectId, [FromBody] ProjectMemberRoleUpdateDto request)
		{
			if (string.IsNullOrWhiteSpace(projectId))
				return BadRequest("ProjectId is required.");

			if (request == null || string.IsNullOrWhiteSpace(request.UserId))
				return BadRequest("UserId is required.");

			try
			{
				var success = _userService.SetProjectMemberRole(projectId, request);
				if (!success)
					return NotFound("User not found.");

				return NoContent();
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while updating project role assignments.");
			}
		}

		private string? ResolveCurrentUserId()
		{
			return
				User.FindFirstValue(ClaimTypes.NameIdentifier) ??
				User.FindFirstValue("userId") ??
				User.FindFirstValue("uid") ??
				User.FindFirstValue("id");
		}
	}
}

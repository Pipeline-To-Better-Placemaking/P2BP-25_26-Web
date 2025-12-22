using BetterPlacemaking.Services;
using BetterPlacemaking.Models;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
	[ApiController]
	[Route("api/[controller]")]
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
	}
}
using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class RegistrationController(UserService userService): ControllerBase
    {
        private readonly UserService _userService = userService;

        [HttpPost]
        public async Task<IActionResult> Register([FromBody] User user)
        {
            var createdUser = await _userService.AddUser(user);

            if (createdUser == null)
                return BadRequest(new { Success = false, Message = "Email already exists" });

            return Ok(new { Success = true, Message = "Registration successful", User = createdUser });
        }
    }
}

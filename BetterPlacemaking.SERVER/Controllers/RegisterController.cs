using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class RegisterController(UserService userService) : ControllerBase
    {
        private readonly UserService _userService = userService;

        [HttpPost]
        public IActionResult Register([FromBody] RegisterRequest request)
        {
            // Map request to User model
            var user = new User
            {
                FirstName = request.FirstName,
                LastName = request.LastName,
                Email = request.Email,
                Password = request.Password
            };

            // Add user (synchronously)
            var createdUser = _userService.AddUser(user);

            if (createdUser == null)
            {
                return BadRequest(new
                {
                    Success = false,
                    Message = "Email already exists"
                });
            }

            return Ok(new
            {
                Success = true,
                Message = "Registration successful",
                User = createdUser
            });
        }
    }
}

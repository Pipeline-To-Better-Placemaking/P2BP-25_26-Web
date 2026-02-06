using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BetterPlacemaking.Models.Dtos;
using System.Security.Claims;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [AllowAnonymous]
    public class PasswordController(PasswordService passwordService) : ControllerBase
    {
        private readonly PasswordService _passwordService = passwordService;


        [HttpPost("request-reset")]
        public IActionResult RequestReset([FromBody] PasswordResetRequest request)
        {
            var success = _passwordService.RequestPasswordReset(request.Email!);
            return success ? Ok("Password reset email sent") : BadRequest("User not found");
        }

        [HttpPost("reset-password")]
        public IActionResult ResetPassword([FromBody] PasswordReset request)
        {
            var success = _passwordService.ResetPassword(request.Token!, request.NewPassword!);
            return success ? Ok("Password updated") : BadRequest("Invalid or expired token");
        }

        [HttpPost("me/change")]
        [Authorize(Policy = "UserJwt")]
        public IActionResult ChangeMyPassword([FromBody] ChangePasswordDto dto)
        {
            if (dto == null) return BadRequest();

            var userId =
                User.FindFirstValue(ClaimTypes.NameIdentifier) ??
                User.FindFirstValue("userId") ??
                User.FindFirstValue("uid") ??
                User.FindFirstValue("id");

            if (string.IsNullOrWhiteSpace(userId))
                return Unauthorized("Missing user id claim.");

            try
            {
                var ok = _passwordService.ChangePassword(userId, dto.CurrentPassword, dto.NewPassword);
                return ok ? NoContent() : BadRequest("Current password is incorrect.");
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while changing password.");
            }
        }


    }
}

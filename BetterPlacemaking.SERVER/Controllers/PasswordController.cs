using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

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
    }
}

using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
	[ApiController]
	[Route("api/[controller]")]
	public class LoginController(LoginService loginService) : ControllerBase
	{
		private readonly LoginService _loginService = loginService;

		[HttpPost("authenticate")]
        public IActionResult Login([FromBody] LoginRequest request)
        {
            var result = _loginService.Login(request.Email!, request.Password!);

            if (!result.Success)
                return Unauthorized(result);

            return Ok(result);
        }
	}
}

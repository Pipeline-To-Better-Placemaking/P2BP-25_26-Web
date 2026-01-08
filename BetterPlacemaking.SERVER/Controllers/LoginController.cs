using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
	[ApiController]
	[Route("api/[controller]")]
	public class LoginController(AuthSessionService authSessionService) : ControllerBase
	{
		private const string RefreshCookieName = "bp_refresh";
		private readonly AuthSessionService _authSessionService = authSessionService;

		[HttpPost("authenticate")]
		[AllowAnonymous]
        public IActionResult Login([FromBody] LoginRequest request)
        {
			var userAgent = Request.Headers.UserAgent.ToString();

			var (result, refreshToken, refreshExpiresAtUtc) =
				_authSessionService.AuthenticateAsync(request.Email!, request.Password!, userAgent).GetAwaiter().GetResult();

            if (!result.Success)
                return Unauthorized(result);

			if (!string.IsNullOrWhiteSpace(refreshToken) && refreshExpiresAtUtc != null)
			{
				Response.Cookies.Append(
					RefreshCookieName,
					refreshToken,
					new CookieOptions
					{
						HttpOnly = true,
						Secure = true,
						SameSite = SameSiteMode.None,
						Path = "/api/auth",
						Expires = refreshExpiresAtUtc
					});
			}

            return Ok(result);
        }
	}
}

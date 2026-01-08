using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/auth")]
    public sealed class AuthController(AuthSessionService authSessionService) : ControllerBase
    {
        private const string RefreshCookieName = "bp_refresh";
        private readonly AuthSessionService _authSessionService = authSessionService;

        [HttpPost("refresh")]
        [AllowAnonymous]
        public async Task<IActionResult> Refresh(CancellationToken cancellationToken)
        {
            if (!Request.Cookies.TryGetValue(RefreshCookieName, out var refreshToken) || string.IsNullOrWhiteSpace(refreshToken))
                return Unauthorized(new LoginResponse { Success = false, Message = "Missing refresh token" });

            var userAgent = Request.Headers.UserAgent.ToString();

            var (response, newRefreshToken, refreshExpiresAtUtc) = await _authSessionService.RefreshAsync(
                refreshToken,
                userAgent,
                cancellationToken);

            if (!response.Success || string.IsNullOrWhiteSpace(newRefreshToken) || refreshExpiresAtUtc == null)
                return Unauthorized(response);

            Response.Cookies.Append(
                RefreshCookieName,
                newRefreshToken,
                new CookieOptions
                {
                    HttpOnly = true,
                    Secure = true,
                    SameSite = SameSiteMode.None,
                    Path = "/api/auth",
                    Expires = refreshExpiresAtUtc
                });

            return Ok(response);
        }

        [HttpPost("logout")]
        [AllowAnonymous]
        public async Task<IActionResult> Logout(CancellationToken cancellationToken)
        {
            if (Request.Cookies.TryGetValue(RefreshCookieName, out var refreshToken) && !string.IsNullOrWhiteSpace(refreshToken))
            {
                await _authSessionService.LogoutAsync(refreshToken, cancellationToken);
            }

            Response.Cookies.Delete(RefreshCookieName, new CookieOptions
            {
                Secure = true,
                SameSite = SameSiteMode.None,
                Path = "/api/auth"
            });

            return Ok(new { Success = true });
        }
    }
}

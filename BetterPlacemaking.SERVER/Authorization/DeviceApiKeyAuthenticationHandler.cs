using System.Text.Encodings.Web;
using System.Security.Claims;
using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BetterPlacemaking.Authorization
{
    public sealed class DeviceApiKeyAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        private readonly DeviceService _deviceService;

        public DeviceApiKeyAuthenticationHandler(
            IOptionsMonitor<AuthenticationSchemeOptions> options,
            ILoggerFactory logger,
            UrlEncoder encoder,
            ISystemClock clock,
            DeviceService deviceService)
            : base(options, logger, encoder, clock)
        {
            _deviceService = deviceService;
        }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue("Authorization", out var authHeaderValues))
                return Task.FromResult(AuthenticateResult.NoResult());

            var authHeader = authHeaderValues.ToString();
            const string bearerPrefix = "Bearer ";

            if (string.IsNullOrWhiteSpace(authHeader) || !authHeader.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase))
                return Task.FromResult(AuthenticateResult.NoResult());

            var apiKey = authHeader.Substring(bearerPrefix.Length).Trim();
            if (string.IsNullOrWhiteSpace(apiKey))
                return Task.FromResult(AuthenticateResult.Fail("Missing device API key"));

            Device? device;
            try
            {
                device = _deviceService.GetDeviceByApiKey(apiKey);
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Device API key lookup failed.");
                return Task.FromResult(AuthenticateResult.Fail("Device API key lookup failed"));
            }

            if (device == null)
                return Task.FromResult(AuthenticateResult.Fail("Invalid device API key"));

            Context.Items["Device"] = device;

            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.NameIdentifier, device.Id ?? string.Empty),
                new Claim("deviceId", device.Id ?? string.Empty)
            };

            var identity = new ClaimsIdentity(claims, Scheme.Name);
            var principal = new ClaimsPrincipal(identity);
            var ticket = new AuthenticationTicket(principal, Scheme.Name);

            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }
}

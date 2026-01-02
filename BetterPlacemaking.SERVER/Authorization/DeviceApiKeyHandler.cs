using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;

namespace BetterPlacemaking.Authorization
{
    public class DeviceApiKeyHandler(DeviceService deviceService, IHttpContextAccessor httpContextAccessor) : AuthorizationHandler<DeviceApiKeyRequirement>
    {
        private readonly DeviceService _deviceService = deviceService;
        private readonly IHttpContextAccessor _httpContextAccessor = httpContextAccessor;

        protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, DeviceApiKeyRequirement requirement)
        {
            var httpContext = _httpContextAccessor.HttpContext;
            if (httpContext == null)
                return Task.CompletedTask;

            var headers = httpContext.Request.Headers;
            string? apiKey = null;

            if (headers.TryGetValue("Authorization", out var authHeader))
            {
                const string bearerPrefix = "Bearer ";
                var auth = authHeader.ToString();
                if (auth.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase))
                    apiKey = auth.Substring(bearerPrefix.Length).Trim();
            }

            if (string.IsNullOrWhiteSpace(apiKey))
                return Task.CompletedTask;

            var device = _deviceService.GetDeviceByApiKey(apiKey);
            
            if (device == null)
                return Task.CompletedTask;

            httpContext.Items["Device"] = device;
            context.Succeed(requirement);

            return Task.CompletedTask;
        }
    }
}

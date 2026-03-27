using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace BetterPlacemaking.Authorization
{
    public sealed class PermissionAuthorizationHandler(
        FirestoreAuthorizationDataService authorizationDataService,
        IHttpContextAccessor httpContextAccessor,
        ILogger<PermissionAuthorizationHandler> logger) : AuthorizationHandler<PermissionRequirement>
    {
        private readonly FirestoreAuthorizationDataService _authorizationDataService = authorizationDataService;
        private readonly IHttpContextAccessor _httpContextAccessor = httpContextAccessor;
        private readonly ILogger<PermissionAuthorizationHandler> _logger = logger;

        protected override async Task HandleRequirementAsync(
            AuthorizationHandlerContext context,
            PermissionRequirement requirement)
        {
            if (context.User.Identity?.IsAuthenticated != true)
                return;

            var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? context.User.FindFirstValue(JwtRegisteredClaimNames.Sub);

            if (string.IsNullOrWhiteSpace(userId))
                return;

            var cancellationToken = _httpContextAccessor.HttpContext?.RequestAborted ?? CancellationToken.None;

            bool allowed;
            if (requirement.Scope == PermissionScope.Global)
            {
                allowed = await _authorizationDataService.HasGlobalPermissionAsync(
                    userId,
                    context.User,
                    requirement.Permission,
                    cancellationToken);
            }
            else
            {
                var projectId = ResolveProjectId(_httpContextAccessor.HttpContext);
                if (string.IsNullOrWhiteSpace(projectId))
                {
                    _logger.LogDebug(
                        "Project permission policy {Permission} evaluated without a project id in request.",
                        requirement.Permission);
                    return;
                }

                allowed = await _authorizationDataService.HasProjectPermissionAsync(
                    userId,
                    projectId,
                    requirement.Permission,
                    cancellationToken);
            }

            if (allowed)
                context.Succeed(requirement);
        }

        private static string? ResolveProjectId(HttpContext? httpContext)
        {
            if (httpContext == null)
                return null;

            if (httpContext.Request.RouteValues.TryGetValue("projectId", out var routeProjectId))
            {
                var value = routeProjectId?.ToString();
                if (!string.IsNullOrWhiteSpace(value))
                    return value;
            }

            if (httpContext.Request.RouteValues.TryGetValue("id", out var routeId))
            {
                var value = routeId?.ToString();
                if (!string.IsNullOrWhiteSpace(value))
                    return value;
            }

            if (httpContext.Request.Query.TryGetValue("projectId", out var queryProjectId))
            {
                var value = queryProjectId.ToString();
                if (!string.IsNullOrWhiteSpace(value))
                    return value;
            }

            if (httpContext.Request.Query.TryGetValue("id", out var queryId))
            {
                var value = queryId.ToString();
                if (!string.IsNullOrWhiteSpace(value))
                    return value;
            }

            return null;
        }
    }
}

using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;

namespace BetterPlacemaking.Authorization
{
    public sealed class PermissionAuthorizationPolicyProvider(IOptions<AuthorizationOptions> options)
        : DefaultAuthorizationPolicyProvider(options)
    {
        public override Task<AuthorizationPolicy?> GetPolicyAsync(string policyName)
        {
            if (PermissionPolicyName.TryParse(policyName, out var scope, out var permission))
            {
                var policy = new AuthorizationPolicyBuilder()
                    .AddAuthenticationSchemes("UserJwt")
                    .RequireAuthenticatedUser()
                    .AddRequirements(new PermissionRequirement(scope, permission))
                    .Build();

                return Task.FromResult<AuthorizationPolicy?>(policy);
            }

            return base.GetPolicyAsync(policyName);
        }
    }
}

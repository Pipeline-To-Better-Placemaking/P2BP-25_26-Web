using Microsoft.AspNetCore.Authorization;

namespace BetterPlacemaking.Authorization
{
    public sealed class RequirePermissionAttribute : AuthorizeAttribute
    {
        public RequirePermissionAttribute(string permission)
        {
            Policy = PermissionPolicyName.For(permission);
        }
    }
}

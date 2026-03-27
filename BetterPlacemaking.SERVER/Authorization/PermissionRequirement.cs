using Microsoft.AspNetCore.Authorization;

namespace BetterPlacemaking.Authorization
{
    public sealed class PermissionRequirement(PermissionScope scope, string permission) : IAuthorizationRequirement
    {
        public PermissionScope Scope { get; } = scope;
        public string Permission { get; } = permission;
    }
}

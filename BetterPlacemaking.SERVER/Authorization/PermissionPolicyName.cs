namespace BetterPlacemaking.Authorization
{
    public enum PermissionScope
    {
        Global,
        Project
    }

    public static class PermissionPolicyName
    {
        public const string Prefix = "Permission";

        public static string For(string permission)
            => $"{Prefix}:{permission}";

        public static bool TryParse(
            string? policyName,
            out PermissionScope scope,
            out string permission)
        {
            scope = default;
            permission = string.Empty;

            if (string.IsNullOrWhiteSpace(policyName))
                return false;

            var parts = policyName.Split(':', 2, System.StringSplitOptions.TrimEntries);
            if (parts.Length != 2)
                return false;

            if (!parts[0].Equals(Prefix, System.StringComparison.Ordinal))
                return false;

            permission = parts[1];
            if (string.IsNullOrWhiteSpace(permission))
                return false;

            if (permission.StartsWith("Global.", System.StringComparison.OrdinalIgnoreCase))
            {
                scope = PermissionScope.Global;
                return true;
            }

            if (permission.StartsWith("Project.", System.StringComparison.OrdinalIgnoreCase))
            {
                scope = PermissionScope.Project;
                return true;
            }

            return false;
        }
    }
}

using Google.Cloud.Firestore;
using Microsoft.Extensions.Logging;

namespace BetterPlacemaking.Authorization
{
    public sealed class AuthorizationRoleSeeder(FirestoreDb db, ILogger<AuthorizationRoleSeeder> logger)
    {
        private readonly FirestoreDb _db = db;
        private readonly ILogger<AuthorizationRoleSeeder> _logger = logger;

        public async Task SeedAsync(CancellationToken cancellationToken = default)
        {
            await SeedRoleIfMissingAsync(
                collection: "role_definitions_global",
                roleName: "SuperAdmin",
                permissions:
                [
                    ..Permissions.Global.All,
                    ..Permissions.Project.All
                ],
                cancellationToken: cancellationToken);

            await SeedRoleIfMissingAsync(
                collection: "role_definitions_global",
                roleName: "Admin",
                permissions:
                [
                    ..Permissions.Global.All,
                    ..Permissions.Project.All
                ],
                cancellationToken: cancellationToken);

            await SeedRoleIfMissingAsync(
                collection: "role_definitions_project",
                roleName: "ProjectAdmin",
                permissions: Permissions.Project.Admin,
                cancellationToken: cancellationToken);

            await SeedRoleIfMissingAsync(
                collection: "role_definitions_project",
                roleName: "ProjectOwner",
                permissions: Permissions.Project.Admin,
                cancellationToken: cancellationToken);

            await SeedRoleIfMissingAsync(
                collection: "role_definitions_project",
                roleName: "ProjectViewer",
                permissions: Permissions.Project.Viewer,
                cancellationToken: cancellationToken);

            await SeedRoleIfMissingAsync(
                collection: "role_definitions_project",
                roleName: "ProjectEditor",
                permissions: Permissions.Project.Editor,
                cancellationToken: cancellationToken);
        }

        private async Task SeedRoleIfMissingAsync(
            string collection,
            string roleName,
            IEnumerable<string> permissions,
            CancellationToken cancellationToken)
        {
            var doc = _db.Collection(collection).Document(roleName);
            var snapshot = await doc.GetSnapshotAsync(cancellationToken);

            if (snapshot.Exists)
                return;

            await doc.SetAsync(
                new Dictionary<string, object>
                {
                    ["permissions"] = permissions.Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),
                    ["isSystem"] = true,
                    ["updatedAt"] = Timestamp.FromDateTime(DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Utc))
                },
                cancellationToken: cancellationToken);

            _logger.LogInformation("Seeded authorization role {RoleName} in {Collection}", roleName, collection);
        }
    }
}

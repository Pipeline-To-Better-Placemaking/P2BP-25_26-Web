using System.Security.Claims;
using System.Text.Json;
using Google.Cloud.Firestore;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging;

namespace BetterPlacemaking.Authorization
{
    public sealed class FirestoreAuthorizationDataService(
        FirestoreDb db,
        IDistributedCache cache,
        ILogger<FirestoreAuthorizationDataService> logger)
    {
        private static readonly TimeSpan GlobalCacheDuration = TimeSpan.FromMinutes(10);
        private static readonly TimeSpan ProjectCacheDuration = TimeSpan.FromMinutes(5);

        private readonly FirestoreDb _db = db;
        private readonly IDistributedCache _cache = cache;
        private readonly ILogger<FirestoreAuthorizationDataService> _logger = logger;

        public async Task<bool> HasGlobalPermissionAsync(
            string userId,
            ClaimsPrincipal principal,
            string permission,
            CancellationToken cancellationToken = default)
        {
            var cacheKey = $"authz:global:user:{userId}:permission:{permission}";
            var cached = await TryGetCachedAsync(cacheKey, cancellationToken);
            if (cached.HasValue)
                return cached.Value;

            var roleSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var role in principal.FindAll(ClaimTypes.Role).Select(c => c.Value))
                if (!string.IsNullOrWhiteSpace(role))
                    roleSet.Add(role);

            var assignmentSnapshot = await _db.Collection("user_global_roles")
                .Document(userId)
                .GetSnapshotAsync(cancellationToken);

            if (assignmentSnapshot.Exists && assignmentSnapshot.TryGetValue("roles", out IEnumerable<string> assignedRoles))
                foreach (var role in assignedRoles)
                    if (!string.IsNullOrWhiteSpace(role))
                        roleSet.Add(role);

            var allowed = await RoleSetContainsPermissionAsync(
                collectionName: "role_definitions_global",
                roles: roleSet,
                permission: permission,
                cancellationToken: cancellationToken);

            await SetCachedAsync(cacheKey, allowed, GlobalCacheDuration, cancellationToken);
            return allowed;
        }

        public async Task<bool> HasProjectPermissionAsync(
            string userId,
            string projectId,
            string permission,
            CancellationToken cancellationToken = default)
        {
            var cacheKey = $"authz:project:user:{userId}:project:{projectId}:permission:{permission}";
            var cached = await TryGetCachedAsync(cacheKey, cancellationToken);
            if (cached.HasValue)
                return cached.Value;

            // Super-admin style global roles can carry project permissions and should short-circuit project checks.
            var globalAssignmentSnapshot = await _db.Collection("user_global_roles")
                .Document(userId)
                .GetSnapshotAsync(cancellationToken);

            var globalRoleSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (globalAssignmentSnapshot.Exists && globalAssignmentSnapshot.TryGetValue("roles", out IEnumerable<string> assignedGlobalRoles))
            {
                foreach (var role in assignedGlobalRoles)
                {
                    if (!string.IsNullOrWhiteSpace(role))
                        globalRoleSet.Add(role);
                }
            }

            if (globalRoleSet.Count > 0)
            {
                var globallyAllowed = await RoleSetContainsPermissionAsync(
                    collectionName: "role_definitions_global",
                    roles: globalRoleSet,
                    permission: permission,
                    cancellationToken: cancellationToken);

                if (globallyAllowed)
                {
                    await SetCachedAsync(cacheKey, true, ProjectCacheDuration, cancellationToken);
                    return true;
                }
            }

            var memberSnapshot = await _db.Collection("projects")
                .Document(projectId)
                .Collection("members")
                .Document(userId)
                .GetSnapshotAsync(cancellationToken);

            if (!memberSnapshot.Exists)
            {
                await SetCachedAsync(cacheKey, false, ProjectCacheDuration, cancellationToken);
                return false;
            }

            var roleSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (memberSnapshot.TryGetValue("roles", out IEnumerable<string> projectRoles))
                foreach (var role in projectRoles)
                    if (!string.IsNullOrWhiteSpace(role))
                        roleSet.Add(role);

            var allowed = await RoleSetContainsPermissionAsync(
                collectionName: "role_definitions_project",
                roles: roleSet,
                permission: permission,
                cancellationToken: cancellationToken);

            await SetCachedAsync(cacheKey, allowed, ProjectCacheDuration, cancellationToken);
            return allowed;
        }

        private async Task<bool> RoleSetContainsPermissionAsync(
            string collectionName,
            IEnumerable<string> roles,
            string permission,
            CancellationToken cancellationToken)
        {
            var roleList = roles.Where(r => !string.IsNullOrWhiteSpace(r)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (roleList.Count == 0)
                return false;

            var fetchTasks = roleList.Select(role => _db.Collection(collectionName).Document(role).GetSnapshotAsync(cancellationToken));
            var roleSnapshots = await Task.WhenAll(fetchTasks);

            foreach (var roleSnapshot in roleSnapshots)
            {
                if (!roleSnapshot.Exists)
                    continue;

                if (!roleSnapshot.TryGetValue("permissions", out IEnumerable<string> permissions))
                    continue;

                if (permissions.Contains(permission, StringComparer.OrdinalIgnoreCase))
                    return true;
            }

            return false;
        }

        private async Task<bool?> TryGetCachedAsync(string key, CancellationToken cancellationToken)
        {
            try
            {
                var json = await _cache.GetStringAsync(key, cancellationToken);
                if (string.IsNullOrWhiteSpace(json))
                    return null;

                return JsonSerializer.Deserialize<bool>(json);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Authorization cache read failed for key {CacheKey}", key);
                return null;
            }
        }

        private async Task SetCachedAsync(string key, bool value, TimeSpan ttl, CancellationToken cancellationToken)
        {
            try
            {
                var json = JsonSerializer.Serialize(value);
                await _cache.SetStringAsync(
                    key,
                    json,
                    new DistributedCacheEntryOptions
                    {
                        AbsoluteExpirationRelativeToNow = ttl
                    },
                    cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Authorization cache write failed for key {CacheKey}", key);
            }
        }
    }
}

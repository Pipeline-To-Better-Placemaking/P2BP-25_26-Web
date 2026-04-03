using BetterPlacemaking.Models;
using Google.Cloud.Firestore;
using BetterPlacemaking.Models.Dtos;

namespace BetterPlacemaking.Services
{
    public class UserService(FirestoreDb db, EmailService emailService)
    {
        private readonly FirestoreDb _db = db;
        private readonly EmailService _emailService = emailService;
        private const string collectionName = "users";

        public List<User> GetUsers()
        {
            var response = _db.Collection(collectionName).GetSnapshotAsync().Result.Documents
                .Select(doc => doc.ConvertTo<User>())
                .ToList();
            return response;
        }

        public User? GetUser(string id)
        {
            var user = _db.Collection(collectionName).Document(id).GetSnapshotAsync().Result
                .ConvertTo<User>();

            return user;
        }

        public User? AddUser(User user)
        {
            var collection = _db.Collection(collectionName);

            var query = collection.WhereEqualTo("Email", user.Email);
            var result = query.GetSnapshotAsync().Result;
            if (result.Count > 0) 
            {
                return null;
            }
            
            user.Password = BCrypt.Net.BCrypt.HashPassword(user.Password);

            user.EmailVerificationToken = Guid.NewGuid().ToString();
            user.EmailVerified = false;
            user.Role = "User";

            var docRef = collection.Document();
            docRef.SetAsync(user).Wait();

            if (!string.IsNullOrEmpty(user.Email) && !string.IsNullOrEmpty(user.EmailVerificationToken))
            {
                _emailService.SendVerificationEmail(user.Email, user.EmailVerificationToken);
            }
            else
            {
                Console.WriteLine("Email or token is null, cannot send verification email.");
            }

            return new User
            {
                FirstName = user.FirstName,
                LastName = user.LastName,
                Email = user.Email,
                Role = user.Role
            };
        }

        public User? UpdateUser(string id, User user)
        {
            var docRef = _db.Collection(collectionName).Document(id);

            docRef.SetAsync(user).Wait();

            var updated = docRef.GetSnapshotAsync().Result
                .ConvertTo<User>();
            return updated;
        }

        public bool DeleteUser(string id)
        {
            var docRef = _db.Collection(collectionName).Document(id);
            var snap = docRef.GetSnapshotAsync().Result;
            if (!snap.Exists)
                return false;

            docRef.DeleteAsync().Wait();
            return true;
        }

        public void UserSettings(string userId, UserSettingsDto dto)
        {
            var docRef = _db.Collection(collectionName).Document(userId);
            var updates = new Dictionary<string, object>();
            
            if (dto.FirstName != null)
            {
                var first = dto.FirstName.Trim();
                if (first.Length > 50) throw new ArgumentException("FirstName must be <= 50 characters.");
                if (first.Length > 0)
                {
                    updates["FirstName"] = first;
                }
            }

            if (dto.LastName != null)
            {
                var last = dto.LastName.Trim();
                if (last.Length > 50) throw new ArgumentException("LastName must be <= 50 characters.");
                updates["LastName"] = last;
            }

            if (dto.EmailAlerts.HasValue) updates["EmailAlerts"] = dto.EmailAlerts.Value;
            if (dto.ScanCompletionAlerts.HasValue) updates["ScanCompletionAlerts"] = dto.ScanCompletionAlerts.Value;
            if (dto.ChangeDetectionAlerts.HasValue) updates["ChangeDetectionAlerts"] = dto.ChangeDetectionAlerts.Value;

            if (updates.Count == 0) return;

            docRef.UpdateAsync(updates).Wait();
        }

        public UserSettingsDto? GetUserSettings(string userId)
        {
            var user = GetUser(userId);
            if (user == null)
                return null;

            return new UserSettingsDto
            {
                FirstName = user.FirstName,
                LastName = user.LastName,
                EmailAlerts = user.EmailAlerts,
                ScanCompletionAlerts = user.ScanCompletionAlerts,
                ChangeDetectionAlerts = user.ChangeDetectionAlerts,
            };
        }

        public List<string> GetProjectRoleOptions()
        {
            var response = _db.Collection("role_definitions_project")
                .GetSnapshotAsync()
                .Result
                .Documents
                .Select(doc => doc.Id)
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(id => id)
                .ToList();

            return response;
        }

        public List<UserProjectRoleAssignmentsDto> GetProjectRoleAssignments()
        {
            var users = GetUsers();
            var projects = _db.Collection("projects")
                .GetSnapshotAsync()
                .Result
                .Documents
                .Select(doc => doc.ConvertTo<Project>())
                .Where(project => !string.IsNullOrWhiteSpace(project.Id))
                .ToList();

            var assignmentMap = new Dictionary<string, List<ProjectRoleAssignmentDto>>(StringComparer.OrdinalIgnoreCase);

            foreach (var project in projects)
            {
                var members = _db.Collection("projects")
                    .Document(project.Id!)
                    .Collection("members")
                    .GetSnapshotAsync()
                    .Result
                    .Documents;

                foreach (var member in members)
                {
                    if (!member.TryGetValue("roles", out IEnumerable<string> roles))
                        continue;

                    var normalizedRoles = roles
                        .Where(role => !string.IsNullOrWhiteSpace(role))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();

                    if (normalizedRoles.Count == 0)
                        continue;

                    if (!assignmentMap.TryGetValue(member.Id, out var assignments))
                    {
                        assignments = [];
                        assignmentMap[member.Id] = assignments;
                    }

                    assignments.Add(new ProjectRoleAssignmentDto
                    {
                        ProjectId = project.Id,
                        ProjectName = project.Title,
                        Roles = normalizedRoles
                    });
                }
            }

            return users.Select(user => new UserProjectRoleAssignmentsDto
            {
                UserId = user.Id,
                FirstName = user.FirstName,
                LastName = user.LastName,
                Email = user.Email,
                Assignments = user.Id != null && assignmentMap.TryGetValue(user.Id, out var assignments)
                    ? assignments
                    : []
            }).ToList();
        }

        public bool SetUserProjectRoleAssignments(UserProjectRoleAssignmentsUpdateDto request)
        {
            if (string.IsNullOrWhiteSpace(request.UserId))
                return false;

            var userSnap = _db.Collection(collectionName).Document(request.UserId).GetSnapshotAsync().Result;
            if (!userSnap.Exists)
                return false;

            foreach (var assignment in request.Assignments)
            {
                if (string.IsNullOrWhiteSpace(assignment.ProjectId))
                    continue;

                var roles = assignment.Roles
                    .Where(role => !string.IsNullOrWhiteSpace(role))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray();

                var memberDocRef = _db.Collection("projects")
                    .Document(assignment.ProjectId)
                    .Collection("members")
                    .Document(request.UserId);

                if (roles.Length == 0)
                {
                    var existing = memberDocRef.GetSnapshotAsync().Result;
                    if (existing.Exists)
                        memberDocRef.DeleteAsync().Wait();

                    continue;
                }

                var memberSnapshot = memberDocRef.GetSnapshotAsync().Result;
                var currentVersion = 0;

                if (memberSnapshot.Exists && memberSnapshot.TryGetValue("authzVersion", out long authzVersion))
                    currentVersion = (int)authzVersion;
                else if (memberSnapshot.Exists && memberSnapshot.TryGetValue("authzVersion", out int authzVersionInt))
                    currentVersion = authzVersionInt;

                memberDocRef.SetAsync(new Dictionary<string, object>
                {
                    ["roles"] = roles,
                    ["authzVersion"] = currentVersion + 1,
                    ["updatedAt"] = Timestamp.FromDateTime(DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Utc))
                }).Wait();
            }

            return true;
        }

        public List<ProjectMemberRoleDto> GetProjectMemberRoles(string projectId)
        {
            var members = _db.Collection("projects")
                .Document(projectId)
                .Collection("members")
                .GetSnapshotAsync()
                .Result
                .Documents;

            var results = new List<ProjectMemberRoleDto>();

            foreach (var member in members)
            {
                var userId = member.Id;
                if (string.IsNullOrWhiteSpace(userId))
                    continue;

                if (!member.TryGetValue("roles", out IEnumerable<string> roles))
                    continue;

                var role = roles.FirstOrDefault(r => !string.IsNullOrWhiteSpace(r))?.Trim();
                if (string.IsNullOrWhiteSpace(role))
                    continue;

                var userSnap = _db.Collection(collectionName).Document(userId).GetSnapshotAsync().Result;
                if (!userSnap.Exists)
                    continue;

                var user = userSnap.ConvertTo<User>();

                results.Add(new ProjectMemberRoleDto
                {
                    UserId = userId,
                    FirstName = user.FirstName,
                    LastName = user.LastName,
                    Email = user.Email,
                    Role = role
                });
            }

            return results
                .OrderBy(r => r.FirstName)
                .ThenBy(r => r.LastName)
                .ThenBy(r => r.Email)
                .ToList();
        }

        public bool SetProjectMemberRole(string projectId, ProjectMemberRoleUpdateDto request)
        {
            if (string.IsNullOrWhiteSpace(request.UserId))
                return false;

            var userSnap = _db.Collection(collectionName).Document(request.UserId).GetSnapshotAsync().Result;
            if (!userSnap.Exists)
                return false;

            var memberDocRef = _db.Collection("projects")
                .Document(projectId)
                .Collection("members")
                .Document(request.UserId);

            var normalizedRole = request.Role?.Trim();
            if (string.IsNullOrWhiteSpace(normalizedRole))
            {
                var existing = memberDocRef.GetSnapshotAsync().Result;
                if (existing.Exists)
                    memberDocRef.DeleteAsync().Wait();

                return true;
            }

            var memberSnapshot = memberDocRef.GetSnapshotAsync().Result;
            var currentVersion = 0;

            if (memberSnapshot.Exists && memberSnapshot.TryGetValue("authzVersion", out long authzVersion))
                currentVersion = (int)authzVersion;
            else if (memberSnapshot.Exists && memberSnapshot.TryGetValue("authzVersion", out int authzVersionInt))
                currentVersion = authzVersionInt;

            memberDocRef.SetAsync(new Dictionary<string, object>
            {
                ["roles"] = new[] { normalizedRole },
                ["authzVersion"] = currentVersion + 1,
                ["updatedAt"] = Timestamp.FromDateTime(DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Utc))
            }).Wait();

            return true;
        }

    }
}

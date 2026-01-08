using BetterPlacemaking.Models;
using Google.Cloud.Firestore;

namespace BetterPlacemaking.Services
{
    public sealed class AuthSessionService(FirestoreDb db, TokenService tokenService, RefreshTokenService refreshTokenService)
    {
        private readonly FirestoreDb _db = db;
        private readonly TokenService _tokenService = tokenService;
        private readonly RefreshTokenService _refreshTokenService = refreshTokenService;

        public async Task<(LoginResponse Response, string? RefreshToken, DateTime? RefreshExpiresAtUtc)> AuthenticateAsync(
            string email,
            string password,
            string? userAgent,
            CancellationToken cancellationToken = default)
        {
            var query = _db.Collection("users").WhereEqualTo("Email", email);
            var result = await query.GetSnapshotAsync(cancellationToken);

            if (result.Count == 0)
            {
                return (new LoginResponse { Success = false, Message = "User does not exist" }, null, null);
            }

            var user = result.Documents[0].ConvertTo<User>();

            var correctPass = BCrypt.Net.BCrypt.Verify(password, user.Password);
            if (!correctPass)
            {
                return (new LoginResponse { Success = false, Message = "Wrong password" }, null, null);
            }

            if (!user.EmailVerified)
            {
                return (new LoginResponse { Success = false, Message = "Email not verified. Please check your email." }, null, null);
            }

            if (string.IsNullOrWhiteSpace(user.Id))
            {
                return (new LoginResponse { Success = false, Message = "User record missing id" }, null, null);
            }

            var userInfo = new User
            {
                Id = user.Id,
                FirstName = user.FirstName,
                LastName = user.LastName,
                Email = user.Email,
                Role = user.Role
            };

            var (accessToken, accessExpiresAtUtc) = _tokenService.CreateUserToken(user);
            var (refreshToken, refreshExpiresAtUtc, _) = await _refreshTokenService.IssueAsync(
                user.Id,
                userAgent,
                cancellationToken);

            var response = new LoginResponse
            {
                Success = true,
                Message = "Login successful",
                User = userInfo,
                Token = accessToken,
                ExpiresAtUtc = accessExpiresAtUtc
            };

            return (response, refreshToken, refreshExpiresAtUtc);
        }

        public async Task<(LoginResponse Response, string? RefreshToken, DateTime? RefreshExpiresAtUtc)> RefreshAsync(
            string refreshToken,
            string? userAgent,
            CancellationToken cancellationToken = default)
        {
            var record = await _refreshTokenService.FindActiveAsync(refreshToken, cancellationToken);
            if (record?.Id == null || string.IsNullOrWhiteSpace(record.UserId))
            {
                return (new LoginResponse { Success = false, Message = "Invalid refresh token" }, null, null);
            }

            var userSnap = await _db.Collection("users").Document(record.UserId).GetSnapshotAsync(cancellationToken);
            if (!userSnap.Exists)
            {
                return (new LoginResponse { Success = false, Message = "User not found" }, null, null);
            }

            var user = userSnap.ConvertTo<User>();
            user.Id ??= record.UserId;

            var now = DateTime.UtcNow;
            if (record.ExpiresAtUtc <= now)
            {
                return (new LoginResponse { Success = false, Message = "Refresh token expired" }, null, null);
            }

            // Rotate: revoke old, issue new
            var (newRefreshToken, newRefreshExpiresAtUtc, newTokenId) = await _refreshTokenService.IssueAsync(
                record.UserId,
                userAgent,
                cancellationToken);

            await _refreshTokenService.RevokeAsync(record.Id, replacedByTokenId: newTokenId, cancellationToken: cancellationToken);

            var userInfo = new User
            {
                Id = user.Id,
                FirstName = user.FirstName,
                LastName = user.LastName,
                Email = user.Email,
                Role = user.Role
            };

            var (accessToken, accessExpiresAtUtc) = _tokenService.CreateUserToken(user);

            var response = new LoginResponse
            {
                Success = true,
                Message = "Refresh successful",
                User = userInfo,
                Token = accessToken,
                ExpiresAtUtc = accessExpiresAtUtc
            };

            return (response, newRefreshToken, newRefreshExpiresAtUtc);
        }

        public async Task<bool> LogoutAsync(string refreshToken, CancellationToken cancellationToken = default)
        {
            var record = await _refreshTokenService.FindActiveAsync(refreshToken, cancellationToken);
            if (record?.Id == null)
                return false;

            await _refreshTokenService.RevokeAsync(record.Id, cancellationToken: cancellationToken);
            return true;
        }
    }
}

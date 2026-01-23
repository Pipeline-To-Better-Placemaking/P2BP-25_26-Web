using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using BetterPlacemaking.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace BetterPlacemaking.Services
{
    public sealed class TokenService(IConfiguration config)
    {
        private readonly IConfiguration _config = config;

        public (string Token, DateTime ExpiresAtUtc) CreateUserToken(User user)
        {
            var key = _config["Jwt:Key"] ?? throw new InvalidOperationException("Jwt:Key missing");
            var issuer = _config["Jwt:Issuer"] ?? throw new InvalidOperationException("Jwt:Issuer missing");
            var audience = _config["Jwt:Audience"] ?? throw new InvalidOperationException("Jwt:Audience missing");

            var expMinutes = 60;
            if (int.TryParse(_config["Jwt:ExpiresMinutes"], out var legacyParsed))
            {
                expMinutes = legacyParsed;
            }

            if (int.TryParse(_config["Auth:AccessTokenMinutes"], out var accessParsed))
            {
                expMinutes = accessParsed;
            }

            var now = DateTime.UtcNow;
            var expires = now.AddMinutes(expMinutes);

            var userId = user.Id ?? string.Empty;
            var email = user.Email ?? string.Empty;
            var role = user.Role ?? string.Empty;

            var claims = new List<Claim>
            {
                new(JwtRegisteredClaimNames.Sub, userId),
                new(JwtRegisteredClaimNames.Email, email),
                new(ClaimTypes.NameIdentifier, userId),
                new(ClaimTypes.Email, email),
                new(ClaimTypes.Role, role)
            };

            var displayName = $"{user.FirstName} {user.LastName}".Trim();
            if (!string.IsNullOrWhiteSpace(displayName))
                claims.Add(new Claim(ClaimTypes.Name, displayName));

            var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key));
            var creds = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);

            var token = new JwtSecurityToken(
                issuer: issuer,
                audience: audience,
                claims: claims,
                notBefore: now,
                expires: expires,
                signingCredentials: creds);

            return (new JwtSecurityTokenHandler().WriteToken(token), expires);
        }
    }
}

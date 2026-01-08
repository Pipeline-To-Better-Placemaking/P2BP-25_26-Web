namespace BetterPlacemaking.Models
{
    public class LoginRequest
    {
        public string? Email { get; set; }
        public string? Password { get; set; }
    }
    public class LoginResponse
    {
        public bool Success { get; set; }
        public string? Message { get; set; }
        public User? User { get; set; }

        public string? Token { get; set; }
        public DateTime? ExpiresAtUtc { get; set; }
    }
}
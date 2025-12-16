namespace BetterPlacemaking.Models
{
    public class PasswordResetRequest
    {
        public string? Email { get; set; }
    }
    public class PasswordReset
    {
        public string? Token { get; set; }
        public string? NewPassword { get; set; }
    }
}
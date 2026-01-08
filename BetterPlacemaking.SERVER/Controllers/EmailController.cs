using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using Google.Cloud.Firestore;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
	[ApiController]
	[Route("api/[controller]")]
	public class EmailController(FirestoreDb db) : ControllerBase
	{
		private readonly FirestoreDb _db = db;

		[HttpGet("verify-email")]
        [AllowAnonymous]
        public IActionResult VerifyEmail(string token)
        {
            var query = _db.Collection("users")
                .WhereEqualTo("EmailVerificationToken", token);

            var result = query.GetSnapshotAsync().Result;

            if (result.Count == 0)
                return BadRequest("Invalid or expired token");

            var doc = result.Documents[0];

            doc.Reference.UpdateAsync(new Dictionary<string, object?>
            {
                { "EmailVerified", true },
                { "EmailVerificationToken", null }
            }).Wait();

            return Ok("Email verified successfully");
        }

	}
}

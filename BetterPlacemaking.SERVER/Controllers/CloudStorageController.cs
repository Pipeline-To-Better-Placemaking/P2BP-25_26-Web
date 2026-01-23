using System.Security.Claims;
using BetterPlacemaking.Models;
using BetterPlacemaking.Models.Dtos;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/files")]
    [Authorize(AuthenticationSchemes = "UserJwt,DeviceApiKey")]
    public sealed class CloudStorageController(CloudStorageService gcs) : ControllerBase
    {
        private readonly CloudStorageService _gcs = gcs;

        [HttpPost("request-upload")]
        public async Task<ActionResult<UploadUrlResponseDto>> RequestUpload(
            [FromBody] RequestUploadUrlDto req,
            CancellationToken ct)
        {
            string ownerKey = GetOwnerKey();

            // Optional: enforce max size at API layer
            const long maxBytes = 10L * 1024 * 1024; // 10 MB
            if (req.SizeBytes > maxBytes) return BadRequest("File too large.");

            var resp = await _gcs.CreateSignedUploadUrlAsync(ownerKey, req, ct);
            return Ok(resp);
        }

        [HttpPost("request-download")]
        public async Task<ActionResult<DownloadUrlResponseDto>> RequestDownload(
            [FromBody] RequestDownloadUrlDto req,
            CancellationToken ct)
        {
            string ownerKey = GetOwnerKey();

            var resp = await _gcs.CreateSignedDownloadUrlAsync(ownerKey, req, ct);
            return Ok(resp);
        }

        private string GetOwnerKey()
        {
            // Device auth: handler sets HttpContext.Items["Device"] and deviceId claim.
            if (HttpContext.Items.TryGetValue("Device", out var deviceObj) && deviceObj is Device device)
            {
                if (!string.IsNullOrWhiteSpace(device.Id))
                    return $"device:{device.Id}";
            }

            var deviceId = User.FindFirstValue("deviceId");
            if (!string.IsNullOrWhiteSpace(deviceId))
                return $"device:{deviceId}";

            // User auth: NameIdentifier claim is set in TokenService.
            var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!string.IsNullOrWhiteSpace(userId))
                return $"user:{userId}";

            throw new UnauthorizedAccessException("No authenticated identity.");
        }
    }
}

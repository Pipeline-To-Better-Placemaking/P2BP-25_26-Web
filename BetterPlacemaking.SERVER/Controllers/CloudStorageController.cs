using BetterPlacemaking.Models.Dtos;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/files")]
    [Authorize(AuthenticationSchemes = "UserJwt,DeviceApiKey")]
    public sealed class CloudStorageController(CloudStorageService gcs, MediaService mediaService) : ControllerBase
    {
        private readonly CloudStorageService _gcs = gcs;
        private readonly MediaService _mediaService = mediaService;

        [HttpPost("request-upload")]
        public async Task<ActionResult<UploadUrlResponseDto>> RequestUpload(
            [FromBody] RequestUploadUrlDto req,
            CancellationToken ct)
        {
            // Optional: enforce max size at API layer
            // const long maxBytes = 10L * 1024 * 1024; // 10 MB
            // if (req.SizeBytes > maxBytes) return BadRequest("File too large.");

            var resp = await _gcs.CreateSignedUploadUrlAsync(req, ct);
            return Ok(resp);
        }

        [HttpPost("request-download")]
        public async Task<ActionResult<DownloadUrlResponseDto>> RequestDownload(
            [FromBody] RequestDownloadUrlDto req,
            CancellationToken ct)
        {
            var resp = await _gcs.CreateSignedDownloadUrlAsync(req, ct);
            return Ok(resp);
        }

        [HttpPost("confirm-upload")]
        public ActionResult<MediaRecordResponseDto> ConfirmUpload(
            [FromBody] ConfirmUploadedMediaDto req)
        {
            // Validate/canonicalize with the same rules used for signed-upload.
            // We don't store the full object path in Firestore (directory + name + extension are stored separately).
            _ = _gcs.BuildObjectPath(req.PathFromRoot, req.FileName, req.Extension);

            var media = _mediaService.Create(req.PathFromRoot, req.FileName, req.Extension);
            return Ok(new MediaRecordResponseDto(
                media.Id,
                media.Name,
                media.PathFromRoot,
                media.Extension));
        }
    }
}

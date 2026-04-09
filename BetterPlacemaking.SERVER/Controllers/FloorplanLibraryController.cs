using System.Security.Claims;
using BetterPlacemaking.Models;
using BetterPlacemaking.Models.Dtos;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/floorplan-library")]
    [Authorize(Policy = "UserJwt")]
    public sealed class FloorplanLibraryController(
        FloorplanLibraryService floorplanLibraryService,
        CloudStorageService cloudStorageService,
        ILogger<FloorplanLibraryController> logger) : ControllerBase
    {
        private readonly FloorplanLibraryService _floorplanLibraryService = floorplanLibraryService;
        private readonly CloudStorageService _cloudStorageService = cloudStorageService;
        private readonly ILogger<FloorplanLibraryController> _logger = logger;

        [HttpGet]
        public async Task<IActionResult> GetMine([FromQuery] string? projectId, CancellationToken ct)
        {
            var userId = ResolveCurrentUserId();
            if (string.IsNullOrWhiteSpace(userId))
                return Unauthorized("Missing user id claim.");

            try
            {
                var items = await _floorplanLibraryService.ListForUserAsync(userId, projectId);
                var dtoTasks = items.Select(item => ToDtoAsync(item, ct));
                var dtos = await Task.WhenAll(dtoTasks);
                return Ok(dtos);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error loading floorplans for user {UserId}", userId);
                return Problem("An unexpected error occurred while loading floorplans.");
            }
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetById(string id, CancellationToken ct)
        {
            var userId = ResolveCurrentUserId();
            if (string.IsNullOrWhiteSpace(userId))
                return Unauthorized("Missing user id claim.");
            if (string.IsNullOrWhiteSpace(id))
                return BadRequest("id is required.");

            try
            {
                var item = await _floorplanLibraryService.GetByIdForUserAsync(userId, id);
                if (item == null)
                    return NotFound("Floorplan not found.");

                return Ok(await ToDtoAsync(item, ct));
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while loading the floorplan.");
            }
        }

        [HttpPost("upload")]
        [Consumes("multipart/form-data")]
        [RequestSizeLimit(25_000_000)]
        public async Task<IActionResult> Upload(
            [FromForm] UploadFloorplanLibraryItemForm form,
            CancellationToken ct)
        {
            var userId = ResolveCurrentUserId();
            if (string.IsNullOrWhiteSpace(userId))
                return Unauthorized("Missing user id claim.");

            if (form?.Image == null)
                return BadRequest("A floorplan image is required.");

            try
            {
                var item = await _floorplanLibraryService.UploadForUserAsync(
                    userId,
                    form.Image,
                    form.Nickname,
                    form.ProjectId,
                    ct);
                return Ok(await ToDtoAsync(item, ct));
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error uploading floorplan for user {UserId}", userId);
                return Problem("An unexpected error occurred while uploading the floorplan.");
            }
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> Update(string id, [FromBody] UpdateFloorplanLibraryItemDto dto, CancellationToken ct)
        {
            var userId = ResolveCurrentUserId();
            if (string.IsNullOrWhiteSpace(userId))
                return Unauthorized("Missing user id claim.");
            if (string.IsNullOrWhiteSpace(id))
                return BadRequest("id is required.");
            if (dto == null)
                return BadRequest("Invalid payload.");

            try
            {
                var item = await _floorplanLibraryService.UpdateForUserAsync(userId, id, dto);
                return Ok(await ToDtoAsync(item, ct));
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (KeyNotFoundException)
            {
                return NotFound("Floorplan not found.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating floorplan {Id} for user {UserId}", id, userId);
                return Problem("An unexpected error occurred while updating the floorplan.");
            }
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(string id)
        {
            var userId = ResolveCurrentUserId();
            if (string.IsNullOrWhiteSpace(userId))
                return Unauthorized("Missing user id claim.");
            if (string.IsNullOrWhiteSpace(id))
                return BadRequest("id is required.");

            try
            {
                var deleted = await _floorplanLibraryService.DeleteForUserAsync(userId, id);
                if (!deleted)
                    return NotFound("Floorplan not found.");

                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting floorplan {Id} for user {UserId}", id, userId);
                return Problem("An unexpected error occurred while deleting the floorplan.");
            }
        }

        private async Task<FloorplanLibraryItemDto> ToDtoAsync(FloorplanLibraryItem item, CancellationToken ct)
        {
            DownloadUrlResponseDto? download = null;
            if (!string.IsNullOrWhiteSpace(item.ImagePath))
            {
                try
                {
                    download = await _cloudStorageService.CreateSignedDownloadUrlAsync(
                        new RequestDownloadUrlDto(item.ImagePath),
                        ct);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Could not generate signed download URL for floorplan {Id} (path: {Path}). " +
                        "This may be a credential issue in local dev — check that GOOGLE_APPLICATION_CREDENTIALS " +
                        "is set to a service account JSON with iam.serviceAccounts.signBlob permission.",
                        item.Id, item.ImagePath);
                }
            }

            var calibration = item.Calibration == null
                ? null
                : new FloorplanCalibrationDto(
                    ReferencePoints: item.Calibration.ReferencePoints ?? [],
                    ReferenceDistanceMm: item.Calibration.ReferenceDistanceMm,
                    MmPerPixel: item.Calibration.MmPerPixel,
                    OriginFp: item.Calibration.OriginFp ?? [],
                    CalibratedAtUtc: item.Calibration.CalibratedAtUtc.ToUniversalTime().ToString("o"));

            return new FloorplanLibraryItemDto(
                Id: item.Id ?? string.Empty,
                ProjectId: item.ProjectId,
                Nickname: item.Nickname ?? string.Empty,
                ImagePath: item.ImagePath ?? string.Empty,
                ImageDownloadUrl: download?.SignedUrl,
                ImageDownloadUrlExpiresAt: download?.ExpiresAt,
                ImageContentType: item.ImageContentType ?? "image/png",
                ImageSizeBytes: item.ImageSizeBytes,
                ImageWidth: item.ImageWidth,
                ImageHeight: item.ImageHeight,
                Calibration: calibration,
                CreatedAtUtc: item.CreatedAtUtc.ToUniversalTime().ToString("o"),
                UpdatedAtUtc: item.UpdatedAtUtc.ToUniversalTime().ToString("o"));
        }

        private string? ResolveCurrentUserId()
        {
            return
                User.FindFirstValue(ClaimTypes.NameIdentifier) ??
                User.FindFirstValue("userId") ??
                User.FindFirstValue("uid") ??
                User.FindFirstValue("id");
        }
    }
}

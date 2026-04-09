using System.Security.Claims;
using BetterPlacemaking.Models;
using BetterPlacemaking.Models.Dtos;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class HomographyController(HomographyService homographyService) : ControllerBase
    {
        private readonly HomographyService _homographyService = homographyService;

        [HttpPost("submit-local")]
        [Authorize(Policy = "DeviceApiKey")]
        public IActionResult SubmitLocal([FromBody] SubmitLocalHomographyDto dto)
        {
            if (dto == null)
                return BadRequest("Invalid payload.");

            try
            {
                if (HttpContext.Items["Device"] is not Device device || string.IsNullOrWhiteSpace(device.Id))
                    return Unauthorized("Invalid API key.");

                var response = _homographyService.SubmitLocalHomography(device.Id, dto);
                return Ok(response);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while storing the local homography.");
            }
        }

        [HttpPost("submit-sightings")]
        [Authorize(Policy = "DeviceApiKey")]
        public IActionResult SubmitSightings([FromBody] SubmitArucoSightingsDto dto)
        {
            if (dto == null)
                return BadRequest("Invalid payload.");

            try
            {
                if (HttpContext.Items["Device"] is not Device device || string.IsNullOrWhiteSpace(device.Id))
                    return Unauthorized("Invalid API key.");

                var response = _homographyService.SubmitArucoSightings(device.Id, dto);
                return Ok(response);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while storing the sightings.");
            }
        }

        [HttpPost("compute-lock")]
        [Authorize(Policy = "UserJwt")]
        public IActionResult ComputeLock()
        {
            try
            {
                var response = _homographyService.ComputeLock();
                return Ok(response);
            }
            catch (InvalidOperationException ex)
            {
                return UnprocessableEntity(ex.Message);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred during homography locking.");
            }
        }

        [HttpGet("intrinsics/{deviceId}/{mac}")]
        [Authorize(Policy = "UserJwt")]
        public IActionResult GetIntrinsics(string deviceId, string mac)
        {
            if (string.IsNullOrWhiteSpace(deviceId) || string.IsNullOrWhiteSpace(mac))
                return BadRequest("deviceId and mac are required.");

            try
            {
                var response = _homographyService.GetIntrinsics(deviceId, mac);
                if (response == null)
                    return NotFound("No intrinsics found for the given device and camera.");
                return Ok(response);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while retrieving camera intrinsics.");
            }
        }

        [HttpGet("session-status/{sessionId}")]
        [Authorize(Policy = "UserJwt")]
        public IActionResult GetSessionStatus(string sessionId)
        {
            if (string.IsNullOrWhiteSpace(sessionId))
                return BadRequest("sessionId is required.");

            try
            {
                var response = _homographyService.GetSessionStatus(sessionId);
                return Ok(response);
            }
            catch (KeyNotFoundException ex)
            {
                return NotFound(ex.Message);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while retrieving session status.");
            }
        }

        [HttpGet("has-local/{deviceId}")]
        [Authorize(Policy = "UserJwt")]
        public IActionResult HasLocalHomography(string deviceId)
        {
            if (string.IsNullOrWhiteSpace(deviceId))
                return BadRequest("deviceId is required.");

            try
            {
                var result = _homographyService.HasLocalHomography(deviceId);
                return Ok(new { HasLocalHomography = result });
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred.");
            }
        }

        [HttpGet("workspace/{projectId}")]
        [Authorize(Policy = "UserJwt")]
        public async Task<IActionResult> GetPuzzleWorkspace(string projectId, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(projectId))
                return BadRequest("projectId is required.");

            try
            {
                var response = await _homographyService.GetPuzzleWorkspaceAsync(projectId, ct);
                return Ok(response);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while loading the puzzle workspace.");
            }
        }

        [HttpPost("workspace/{projectId}/puzzle-pieces/refresh")]
        [Authorize(Policy = "UserJwt")]
        public async Task<IActionResult> RefreshPuzzlePieces(string projectId, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(projectId))
                return BadRequest("projectId is required.");

            try
            {
                var response = await _homographyService.RefreshPuzzlePiecesAsync(projectId, ct);
                return Ok(response);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while regenerating puzzle pieces.");
            }
        }

        [HttpGet("workspace/{projectId}/puzzle-pieces/{deviceId}/{cameraMac}")]
        [Authorize(Policy = "UserJwt")]
        public async Task<IActionResult> GetPuzzlePiece(
            string projectId,
            string deviceId,
            string cameraMac,
            [FromQuery] bool force,
            CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(projectId))
                return BadRequest("projectId is required.");
            if (string.IsNullOrWhiteSpace(deviceId) || string.IsNullOrWhiteSpace(cameraMac))
                return BadRequest("deviceId and cameraMac are required.");

            try
            {
                var response = await _homographyService.GetPuzzlePieceAsync(projectId, deviceId, cameraMac, force, ct);
                return Ok(response);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (KeyNotFoundException ex)
            {
                return NotFound(ex.Message);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while loading the puzzle piece.");
            }
        }

        [HttpPost("workspace/{projectId}/global-homographies")]
        [Authorize(Policy = "UserJwt")]
        public IActionResult SaveGlobalHomographies(string projectId, [FromBody] SaveGlobalHomographiesDto dto)
        {
            if (string.IsNullOrWhiteSpace(projectId))
                return BadRequest("projectId is required.");
            if (dto == null)
                return BadRequest("Invalid payload.");

            var userId = ResolveCurrentUserId();
            if (string.IsNullOrWhiteSpace(userId))
                return Unauthorized("Missing user id claim.");

            try
            {
                var response = _homographyService.SaveGlobalHomographies(projectId, userId, dto);
                return Ok(response);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while saving global homographies.");
            }
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

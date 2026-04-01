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
    }
}

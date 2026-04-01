using BetterPlacemaking.Models;
using BetterPlacemaking.Models.Dtos;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class IntrinsicsController(IntrinsicsService intrinsicsService) : ControllerBase
    {
        private readonly IntrinsicsService _intrinsicsService = intrinsicsService;

        [HttpPost("submit-sightings")]
        [Authorize(Policy = "DeviceApiKey")]
        public IActionResult SubmitSightings([FromBody] SubmitIntrinsicsSightingsDto dto)
        {
            if (dto == null)
                return BadRequest("Invalid payload.");

            try
            {
                if (HttpContext.Items["Device"] is not Device device || string.IsNullOrWhiteSpace(device.Id))
                    return Unauthorized("Invalid API key.");

                var response = _intrinsicsService.SubmitSightings(device.Id, dto);
                return Ok(response);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while storing intrinsics sightings.");
            }
        }

        [HttpPost("submit-result")]
        [Authorize(Policy = "DeviceApiKey")]
        public IActionResult SubmitResult([FromBody] SubmitIntrinsicsResultDto dto)
        {
            if (dto == null)
                return BadRequest("Invalid payload.");

            try
            {
                if (HttpContext.Items["Device"] is not Device device || string.IsNullOrWhiteSpace(device.Id))
                    return Unauthorized("Invalid API key.");

                var response = _intrinsicsService.StoreResult(device.Id, dto);
                return Ok(response);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while storing the intrinsics result.");
            }
        }

        [HttpGet("{deviceId}/{mac}")]
        [Authorize(Policy = "UserJwt")]
        public IActionResult GetIntrinsics(string deviceId, string mac, [FromQuery] string? modelId = null)
        {
            if (string.IsNullOrWhiteSpace(deviceId) || string.IsNullOrWhiteSpace(mac))
                return BadRequest("deviceId and mac are required.");

            try
            {
                var response = _intrinsicsService.GetIntrinsics(deviceId, mac, modelId);
                if (response == null)
                    return NotFound("No intrinsics found for the given device and camera.");
                return Ok(response);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while retrieving camera intrinsics.");
            }
        }

        [HttpGet("model/{modelId}")]
        [Authorize(Policy = "UserJwt")]
        public IActionResult GetModelIntrinsics(string modelId)
        {
            if (string.IsNullOrWhiteSpace(modelId))
                return BadRequest("modelId is required.");

            try
            {
                var response = _intrinsicsService.GetModelIntrinsics(modelId);
                if (response == null)
                    return NotFound("No intrinsics found for the given model.");
                return Ok(response);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while retrieving model intrinsics.");
            }
        }
    }
}

using BetterPlacemaking.Models.Dtos.Fusion;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Policy = "UserJwt")]
    public class FusionController(FusionService fusionService) : ControllerBase
    {
        private readonly FusionService _fusionService = fusionService;

        [HttpGet("history")]
        public IActionResult GetHistory([FromQuery] int limit = 50)
        {
            try
            {
                var history = _fusionService.GetHistory(limit);
                return Ok(history);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while retrieving fusion history.");
            }
        }

        [HttpPost("trigger")]
        public IActionResult TriggerFusion([FromBody] TriggerFusionDto dto)
        {
            if (dto == null)
                return BadRequest("Invalid payload.");

            if (dto.FromDateUnix >= dto.ToDateUnix)
                return BadRequest("fromDateUnix must be before toDateUnix.");

            try
            {
                var run = _fusionService.TriggerFusion(dto.FromDateUnix, dto.ToDateUnix, "manual");
                return Ok(run);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while triggering fusion.");
            }
        }

        [HttpGet("config")]
        public IActionResult GetConfig()
        {
            try
            {
                var config = _fusionService.GetConfig();
                return Ok(config);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while retrieving fusion config.");
            }
        }

        [HttpPut("config")]
        public IActionResult UpdateConfig([FromBody] UpdateFusionConfigDto dto)
        {
            if (dto == null)
                return BadRequest("Invalid payload.");

            try
            {
                var updated = _fusionService.UpdateConfig(dto);
                return Ok(updated);
            }
            catch (ArgumentOutOfRangeException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while updating fusion config.");
            }
        }
    }
}

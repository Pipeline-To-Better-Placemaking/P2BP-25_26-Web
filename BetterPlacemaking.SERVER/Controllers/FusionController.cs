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
            try { return Ok(_fusionService.GetHistory(limit)); }
            catch (Exception) { return Problem("Error retrieving fusion history."); }
        }

        [HttpPost("trigger")]
        public IActionResult TriggerFusion([FromBody] TriggerFusionDto dto)
        {
            if (dto == null) return BadRequest("Invalid payload.");
            if (dto.FromDateUnix >= dto.ToDateUnix) return BadRequest("From must be before To.");

            try
            {
                var run = _fusionService.TriggerFusion(dto.FromDateUnix, dto.ToDateUnix, "manual");
                return Ok(run);
            }
            catch (Exception)
            {
                return Problem("Error triggering fusion.");
            }
        }
        
        [HttpDelete("{runId}")]
        public async Task<IActionResult> DeleteRun(string runId)
        {
            if (string.IsNullOrWhiteSpace(runId)) return BadRequest("runId required.");
            try { await _fusionService.DeleteRunAsync(runId); return NoContent(); }
            catch (Exception) { return Problem("Error deleting fusion run."); }
        }

        [HttpGet("{runId}/download-url")]
        public async Task<IActionResult> GetDownloadUrl(string runId)
        {
            try
            {
                var url = await _fusionService.GetDownloadUrlAsync(runId);
                if (url == null) return NotFound("No output file for this run.");
                return Ok(new { url });
            }
            catch (Exception) { return Problem("Error generating download URL."); }
        }

        [HttpGet("config")]
        public IActionResult GetConfig()
        {
            try { return Ok(_fusionService.GetConfig()); }
            catch (Exception) { return Problem("Error retrieving fusion config."); }
        }

        [HttpPut("config")]
        public IActionResult UpdateConfig([FromBody] UpdateFusionConfigDto dto)
        {
            if (dto == null) return BadRequest("Invalid payload.");
            try { return Ok(_fusionService.UpdateConfig(dto)); }
            catch (ArgumentOutOfRangeException ex) { return BadRequest(ex.Message); }
            catch (Exception) { return Problem("Error updating fusion config."); }
        }
    }
}

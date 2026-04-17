using BetterPlacemaking.Models.Dtos.Fusion;
using BetterPlacemaking.Services;
using BetterPlacemaking.Models.Fusion;
using Google.Cloud.Firestore;   
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Policy = "UserJwt")]
    public class FusionController(FusionService fusionService, CloudStorageService gcs, FirestoreDb db) : ControllerBase
    {
        private readonly FusionService _fusionService = fusionService;
        private readonly CloudStorageService _gcs = gcs;
        private readonly FirestoreDb _db = db;

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
                var run = _fusionService.TriggerFusion(dto.FromDateUnix, dto.ToDateUnix, "manual", dto.ProjectId);
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

        [HttpGet("{runId}/download")]
        public async Task<IActionResult> DownloadRun(string runId, CancellationToken ct)
        {
            var snap = await _db.Collection("fusion_runs").Document(runId).GetSnapshotAsync(ct);
            if (!snap.Exists) return NotFound();

            var run = snap.ConvertTo<FusionRun>();
            if (string.IsNullOrWhiteSpace(run.OutputGcsPath)) return NotFound();

            var bytes    = await _gcs.DownloadBytesAsync(run.OutputGcsPath, ct);
            var filename = run.OutputGcsPath.Split('/').Last();

            return File(bytes, "application/json", filename);
        }

        [HttpGet("config")]
        public IActionResult GetConfig([FromQuery] string? projectId = null)
        {
            try { return Ok(_fusionService.GetConfig(projectId)); }
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

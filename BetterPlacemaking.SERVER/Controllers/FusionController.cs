using BetterPlacemaking.Models.Dtos.Fusion;
using BetterPlacemaking.Services;
using BetterPlacemaking.Models.Fusion;
using BetterPlacemaking.Authorization;
using Google.Cloud.Firestore;   
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Policy = "UserJwt")]
    public class FusionController(
        FusionService fusionService,
        CloudStorageService gcs,
        FirestoreDb db,
        FirestoreAuthorizationDataService authorizationDataService) : ControllerBase
    {
        private readonly FusionService _fusionService = fusionService;
        private readonly CloudStorageService _gcs = gcs;
        private readonly FirestoreDb _db = db;
        private readonly FirestoreAuthorizationDataService _authorizationDataService = authorizationDataService;

        [HttpGet("history")]
        [RequirePermission(Permissions.Project.ScansRead)]
        public IActionResult GetHistory([FromQuery] string projectId, [FromQuery] int limit = 50)
        {
            if (string.IsNullOrWhiteSpace(projectId)) return BadRequest("projectId required.");
            try { return Ok(_fusionService.GetHistory(projectId, limit)); }
            catch (Exception) { return Problem("Error retrieving fusion history."); }
        }

        [HttpPost("trigger")]
        [RequirePermission(Permissions.Project.ScansStart)]
        public IActionResult TriggerFusion([FromQuery] string projectId, [FromBody] TriggerFusionDto dto)
        {
            if (string.IsNullOrWhiteSpace(projectId)) return BadRequest("projectId required.");
            if (dto == null) return BadRequest("Invalid payload.");
            if (dto.FromDateUnix >= dto.ToDateUnix) return BadRequest("From must be before To.");

            try
            {
                var run = _fusionService.TriggerFusion(dto.FromDateUnix, dto.ToDateUnix, "manual", projectId);
                return Ok(run);
            }
            catch (Exception)
            {
                return Problem("Error triggering fusion.");
            }
        }
        
        [HttpDelete("{runId}")]
        public async Task<IActionResult> DeleteRun(string runId, CancellationToken cancellationToken)
        {
            var authorization = await GetAuthorizedRunAsync(runId, Permissions.Project.ScansDelete, cancellationToken);
            if (authorization.Error != null) return authorization.Error;

            try { await _fusionService.DeleteRunAsync(runId); return NoContent(); }
            catch (Exception) { return Problem("Error deleting fusion run."); }
        }

        [HttpPost("{runId}/cancel")]
        public async Task<IActionResult> CancelRun(string runId, CancellationToken cancellationToken)
        {
            var authorization = await GetAuthorizedRunAsync(runId, Permissions.Project.ScansStart, cancellationToken);
            if (authorization.Error != null) return authorization.Error;

            var result = await _fusionService.CancelRunAsync(runId);
            return result switch
            {
                "cancelling"  => Accepted(new { status = "cancelling" }),    // 202
                "stale"       => Ok(new { status = "cancelled" }),
                "not_running" => Conflict(new { error = "Run is not in a running state" }),
                "not_found"   => NotFound(),
                _             => StatusCode(500),
            };
        }

        [HttpGet("{runId}/download-url")]
        public async Task<IActionResult> GetDownloadUrl(string runId, CancellationToken cancellationToken)
        {
            var authorization = await GetAuthorizedRunAsync(runId, Permissions.Project.Export, cancellationToken);
            if (authorization.Error != null) return authorization.Error;

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
            var authorization = await GetAuthorizedRunAsync(runId, Permissions.Project.Export, ct);
            if (authorization.Error != null) return authorization.Error;

            var snap = await _db.Collection("fusion_runs").Document(runId).GetSnapshotAsync(ct);
            if (!snap.Exists) return NotFound();

            var run = snap.ConvertTo<FusionRun>();
            if (string.IsNullOrWhiteSpace(run.OutputGcsPath)) return NotFound();

            var bytes    = await _gcs.DownloadBytesAsync(run.OutputGcsPath, ct);
            var filename = run.OutputGcsPath.Split('/').Last();

            return File(bytes, "application/json", filename);
        }

        [HttpGet("config")]
        [RequirePermission(Permissions.Project.ScanSchedulesRead)]
        public IActionResult GetConfig([FromQuery] string? projectId = null)
        {
            if (string.IsNullOrWhiteSpace(projectId)) return BadRequest("projectId required.");
            try { return Ok(_fusionService.GetConfig(projectId)); }
            catch (Exception) { return Problem("Error retrieving fusion config."); }
        }

        [HttpPut("config")]
        [RequirePermission(Permissions.Project.ScanSchedulesManage)]
        public IActionResult UpdateConfig([FromQuery] string projectId, [FromBody] UpdateFusionConfigDto dto)
        {
            if (string.IsNullOrWhiteSpace(projectId)) return BadRequest("projectId required.");
            if (dto == null) return BadRequest("Invalid payload.");
            try { return Ok(_fusionService.UpdateConfig(dto with { ProjectId = projectId })); }
            catch (ArgumentOutOfRangeException ex) { return BadRequest(ex.Message); }
            catch (Exception) { return Problem("Error updating fusion config."); }
        }

        private async Task<(IActionResult? Error, FusionRun? Run)> GetAuthorizedRunAsync(
            string runId,
            string permission,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(runId))
                return (BadRequest("runId required."), null);

            var snap = await _db.Collection("fusion_runs").Document(runId).GetSnapshotAsync(cancellationToken);
            if (!snap.Exists)
                return (NotFound(), null);

            var run = snap.ConvertTo<FusionRun>();
            if (string.IsNullOrWhiteSpace(run.ProjectId))
                return (Forbid(), null);

            var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);
            if (string.IsNullOrWhiteSpace(userId))
                return (Unauthorized(), null);

            var allowed = await _authorizationDataService.HasProjectPermissionAsync(
                userId,
                run.ProjectId,
                permission,
                cancellationToken);

            return allowed ? (null, run) : (Forbid(), null);
        }
    }
}

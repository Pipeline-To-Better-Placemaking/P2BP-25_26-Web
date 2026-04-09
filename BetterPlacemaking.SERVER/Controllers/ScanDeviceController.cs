using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    /// <summary>
    /// Device-authenticated scan queue for Jetson orchestrator (API key in Authorization header).
    /// </summary>
    [ApiController]
    [Route("api/scan/device")]
    [Authorize(Policy = "DeviceApiKey")]
    public sealed class ScanDeviceController(
        ScanService scanService,
        ScanCompleteVisualizerIngestService scanIngest,
        NotificationService notificationService) : ControllerBase
    {
        private readonly ScanService _scanService = scanService;
        private readonly ScanCompleteVisualizerIngestService _scanIngest = scanIngest;
        private readonly NotificationService _notificationService = notificationService;

        [HttpGet("next-pending")]
        public IActionResult GetNextPending()
        {
            if (HttpContext.Items["Device"] is not Device device || string.IsNullOrWhiteSpace(device.Id))
                return Unauthorized();

            if (string.IsNullOrWhiteSpace(device.ProjectId))
                return NotFound("Device has no ProjectId; assign the device to a project in admin.");

            var scanId = _scanService.GetNextPendingScanId(device.ProjectId, device.Id);
            if (string.IsNullOrWhiteSpace(scanId))
                return NotFound();

            return Ok(new
            {
                ProjectId = device.ProjectId,
                DeviceId = device.Id,
                ScanId = scanId
            });
        }

        [HttpPatch("{scanId}/status")]
        public async Task<IActionResult> PatchStatus(
            string scanId,
            [FromBody] UpdateScanStatusRequest? body,
            CancellationToken cancellationToken)
        {
            if (HttpContext.Items["Device"] is not Device device || string.IsNullOrWhiteSpace(device.Id))
                return Unauthorized();

            if (string.IsNullOrWhiteSpace(device.ProjectId))
                return BadRequest("Device has no ProjectId.");

            if (body == null || string.IsNullOrWhiteSpace(scanId))
                return BadRequest();

            var existing = _scanService.GetScan(device.ProjectId, device.Id, scanId);
            if (existing == null)
                return NotFound();

            var updated = _scanService.UpdateScanStatus(
                device.ProjectId,
                device.Id,
                scanId,
                body.Status,
                body.ObjUrl,
                body.Error);

            if (!updated)
                return NotFound();

            var scan = _scanService.GetScan(device.ProjectId, device.Id, scanId);
            await _scanIngest.TryIngestFromScanDocumentAsync(scan, cancellationToken).ConfigureAwait(false);

            if (body.Status?.Trim().Equals("complete", StringComparison.OrdinalIgnoreCase) == true
                && !string.IsNullOrWhiteSpace(device.ProjectId))
            {
                var initiatedBy = scan?.TryGetValue("InitiatedByUserId", out var uid) == true ? uid?.ToString() : null;
                if (!string.IsNullOrWhiteSpace(initiatedBy))
                {
                    _notificationService.NotifyScanCompleted(initiatedBy, device.ProjectId);
                }
            }

            return NoContent();
        }
    }
}

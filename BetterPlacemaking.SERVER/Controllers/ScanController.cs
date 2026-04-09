//scan history / per-project scan records, not the command queue
using System.Security.Claims;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
	[ApiController]
	[Route("api/[controller]")]
	[Authorize(Policy = "UserJwt")]
	public class ScanController(
		ScanService scanService,
		ScanCompleteVisualizerIngestService scanIngest,
		NotificationService notificationService) : ControllerBase
	{
		private readonly ScanService _scanService = scanService;
		private readonly ScanCompleteVisualizerIngestService _scanIngest = scanIngest;
		private readonly NotificationService _notificationService = notificationService;

		[HttpPost("{projectId}/{deviceId}")]
		public IActionResult StartScan(string projectId, string deviceId)
		{
			if (string.IsNullOrWhiteSpace(projectId) || string.IsNullOrWhiteSpace(deviceId))
				return BadRequest();

			try
			{
				var userId = ResolveCurrentUserId();
				var response = _scanService.CreateScan(projectId, deviceId, userId);
				return Ok(response);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while starting the scan.");
			}
		}

		[HttpGet("{projectId}/{deviceId}")]
		public IActionResult GetScans(string projectId, string deviceId)
		{
			if (string.IsNullOrWhiteSpace(projectId) || string.IsNullOrWhiteSpace(deviceId))
				return BadRequest();

			try
			{
				var response = _scanService.GetScans(projectId, deviceId);
				return Ok(response);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while retrieving scans.");
			}
		}

		[HttpGet("{projectId}/{deviceId}/{scanId}")]
		public IActionResult GetScan(string projectId, string deviceId, string scanId)
		{
			if (string.IsNullOrWhiteSpace(projectId) || string.IsNullOrWhiteSpace(deviceId) || string.IsNullOrWhiteSpace(scanId))
				return BadRequest();

			try
			{
				var response = _scanService.GetScan(projectId, deviceId, scanId);
				if (response == null)
					return NotFound();
				return Ok(response);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while retrieving the scan.");
			}
		}

		[HttpPatch("{projectId}/{deviceId}/{scanId}/status")]
		public async Task<IActionResult> UpdateScanStatus(
			string projectId,
			string deviceId,
			string scanId,
			[FromBody] UpdateScanStatusRequest request,
			CancellationToken cancellationToken)
		{
			if (string.IsNullOrWhiteSpace(projectId) ||
				string.IsNullOrWhiteSpace(deviceId) ||
				string.IsNullOrWhiteSpace(scanId) ||
				request == null)
				return BadRequest();

			try
			{
				var updated = _scanService.UpdateScanStatus(
					projectId,
					deviceId,
					scanId,
					request.Status,
					request.ObjUrl,
					request.Error
				);

				if (!updated)
					return NotFound();

				var scan = _scanService.GetScan(projectId, deviceId, scanId);
				await _scanIngest.TryIngestFromScanDocumentAsync(scan, cancellationToken).ConfigureAwait(false);

				if (request.Status?.Trim().Equals("complete", StringComparison.OrdinalIgnoreCase) == true)
				{
					var initiatedBy = scan?.TryGetValue("InitiatedByUserId", out var uid) == true ? uid?.ToString() : null;
					if (!string.IsNullOrWhiteSpace(initiatedBy))
					{
						_notificationService.NotifyScanCompleted(initiatedBy, projectId);
					}
				}

				return NoContent();
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while updating the scan status.");
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

	public class UpdateScanStatusRequest
	{
		public string? Status { get; set; }
		public string? ObjUrl { get; set; }
		public string? Error { get; set; }
	}
}
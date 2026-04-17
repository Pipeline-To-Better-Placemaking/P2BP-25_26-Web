//scan history / per-project scan records, not the command queue
using System.Security.Claims;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BetterPlacemaking.Models;
using Google.Rpc;
namespace BetterPlacemaking.Controllers
{
	[ApiController]
	[Route("api/[controller]")]
	[Authorize(Policy = "UserJwt")]
	public class ScanController(
		ScanService scanService,
		DeviceService deviceService,
		ScanCompleteVisualizerIngestService scanIngest,
		NotificationService notificationService) : ControllerBase
	{
		private readonly ScanService _scanService = scanService;
		private readonly DeviceService _deviceService = deviceService;
		private readonly ScanCompleteVisualizerIngestService _scanIngest = scanIngest;
		private readonly NotificationService _notificationService = notificationService;

		[HttpPost("{projectId}/{deviceId}")]
		public IActionResult StartScan(string projectId, string deviceId, [FromBody] ScanSettingsRequest? settings)
		{
			Console.WriteLine("StartScan endpoint HIT");
			if (string.IsNullOrWhiteSpace(projectId) || string.IsNullOrWhiteSpace(deviceId))
				return BadRequest();

			if (settings == null)
				return BadRequest("Scan settings are required.");

			try
			{
				var existing = _scanService.HasPendingOrRunningScan(projectId, deviceId);
				if (existing.Exists)
				{
					// A scan the orchestrator has already claimed is genuinely in progress.
					if (string.Equals(existing.Status, "running", StringComparison.OrdinalIgnoreCase))
					{
						return Conflict(new
						{
							reason = "scan_in_progress",
							message = "A scan is already running for this device.",
							scanId = existing.ScanId,
							status = existing.Status
						});
					}

					// Pending means the orchestrator hasn't claimed it yet. Re-arm the device
					// flag in case the first heartbeat delivery was lost, and return the existing
					// scan so a retry from the UI is idempotent rather than stuck behind a 409.
					if (!string.IsNullOrWhiteSpace(deviceId))
						_deviceService.StartLidarScan(deviceId, settings);

					return Ok(new { Id = existing.ScanId, Status = existing.Status });
				}

				var userId = ResolveCurrentUserId();
				var response = _scanService.CreateScan(projectId, deviceId, settings, userId);
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

		/// <summary>
		/// Loads the newest <c>complete</c> device scan for this project into the in-memory visualizer (3D tab).
		/// Tries Firestore <c>ObjUrl</c> then canonical GCS <c>vision/lidar-scans/{projectId}/{deviceId}/{scanId}.xyz</c>.
		/// </summary>
		[HttpPost("{projectId}/visualizer/latest")]
		public async Task<IActionResult> LoadLatestCompleteScanIntoVisualizer(
			string projectId,
			CancellationToken cancellationToken)
		{
			if (string.IsNullOrWhiteSpace(projectId))
				return BadRequest();

			try
			{
				var devices = _deviceService.GetDevicesByProjectId(projectId);
				var deviceIds = devices
					.Select(d => d.Id)
					.Where(id => !string.IsNullOrWhiteSpace(id))
					.Select(id => id!)
					.ToList();
				if (deviceIds.Count == 0)
					return Ok(new { success = false, reason = "no_devices", message = "No devices assigned to this project." });

				var latest = _scanService.GetLatestCompleteScanForProject(projectId, deviceIds);
				if (latest == null)
					return Ok(new { success = false, reason = "no_complete_scan", message = "No completed lidar scan for this project." });

				var (deviceId, scan) = latest.Value;
				var result = await _scanIngest
					.TryIngestCompleteScanForVisualizerAsync(projectId, deviceId, scan, cancellationToken)
					.ConfigureAwait(false);

				if (result.Loaded)
					return Ok(new { success = true, deviceId, scanId = scan.TryGetValue("Id", out var id) ? id?.ToString() : null });

				return Ok(new { success = false, reason = result.Reason, message = result.Message, deviceId });
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while loading the latest scan into the visualizer.");
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
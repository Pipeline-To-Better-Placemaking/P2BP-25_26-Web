//scan history / per-project scan records, not the command queue
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
	[ApiController]
	[Route("api/[controller]")]
	[Authorize(Policy = "UserJwt")]
	public class ScanController(ScanService scanService) : ControllerBase
	{
		private readonly ScanService _scanService = scanService;

		[HttpPost("{projectId}/{deviceId}")]
		public IActionResult StartScan(string projectId, string deviceId)
		{
			if (string.IsNullOrWhiteSpace(projectId) || string.IsNullOrWhiteSpace(deviceId))
				return BadRequest();

			try
			{
				var response = _scanService.CreateScan(projectId, deviceId);
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
		public IActionResult UpdateScanStatus(string projectId, string deviceId, string scanId, [FromBody] UpdateScanStatusRequest request)
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

				return NoContent();
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while updating the scan status.");
			}
		}
	}

	public class UpdateScanStatusRequest
	{
		public string? Status { get; set; }
		public string? ObjUrl { get; set; }
		public string? Error { get; set; }
	}
}
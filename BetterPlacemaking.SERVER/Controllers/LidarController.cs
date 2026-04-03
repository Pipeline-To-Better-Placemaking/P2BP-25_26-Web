using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Policy = "UserJwt")]
    public class LidarController(LidarService lidarService) : ControllerBase
    {
        private readonly LidarService _lidarService = lidarService;

        [HttpPost("{projectId}/scan/{deviceId}")]
public IActionResult StartScan(string projectId, string deviceId)
{
    if (string.IsNullOrWhiteSpace(projectId) || string.IsNullOrWhiteSpace(deviceId))
        return BadRequest();

    try
    {
        var response = _lidarService.StartScan(projectId, deviceId);
        return Ok(response);
    }
    catch (Exception)
    {
        return Problem("Error starting LiDAR scan.");
    }
}

        [HttpGet("{projectId}")]
public IActionResult GetScans(string projectId)
        {
            try
            {
                var scans = _lidarService.GetScans(projectId);
                return Ok(scans);
            }
            catch (Exception)
            {
                return Problem("Error retrieving scans.");
            }
        }

        [HttpGet("{projectId}/{id}")]
public IActionResult GetScan(string projectId, string id)
        {
            try
            {
                var scan = _lidarService.GetScan(projectId, id);
                if (scan == null)
                    return NotFound();

                return Ok(scan);
            }
            catch (Exception)
            {
                return Problem("Error retrieving scan.");
            }
        }

        [HttpPatch("{projectId}/{id}/status")]
public IActionResult UpdateScanStatus(string projectId, string id, [FromBody] UpdateLidarScanStatusRequest request)
{
    if (string.IsNullOrWhiteSpace(id) || request == null || string.IsNullOrWhiteSpace(request.Status))
        return BadRequest();

    try
    {
        var updated = _lidarService.UpdateScanStatus(projectId, id, request.Status, request.FileUrl, request.Error);

        if (!updated)
            return NotFound();

        return NoContent();
    }
    catch (Exception)
    {
        return Problem("Error updating scan status.");
    }
}
public class UpdateLidarScanStatusRequest
{
    public string? Status { get; set; }
    public string? FileUrl { get; set; }
    public string? Error { get; set; }
}
    }
}
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

        [HttpPost("scan/{deviceId}")]
        public IActionResult StartScan(string deviceId)
        {
            try
            {
                var response = _lidarService.StartScan(deviceId);
                return Ok(response);
            }
            catch (Exception)
            {
                return Problem("Error starting LiDAR scan.");
            }
        }

        [HttpGet]
        public IActionResult GetScans()
        {
            try
            {
                var scans = _lidarService.GetScans();
                return Ok(scans);
            }
            catch (Exception)
            {
                return Problem("Error retrieving scans.");
            }
        }

        [HttpGet("{id}")]
        public IActionResult GetScan(string id)
        {
            try
            {
                var scan = _lidarService.GetScan(id);
                if (scan == null)
                    return NotFound();

                return Ok(scan);
            }
            catch (Exception)
            {
                return Problem("Error retrieving scan.");
            }
        }
    }
}
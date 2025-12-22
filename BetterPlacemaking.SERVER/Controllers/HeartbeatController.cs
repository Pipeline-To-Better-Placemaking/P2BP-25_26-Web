using BetterPlacemaking.Models;
using BetterPlacemaking.Models.JetsonDTOs;
using BetterPlacemaking.Services;
using Google.Cloud.Firestore;

using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class HeartbeatController(FirestoreDb firestoreDb) : ControllerBase
    {
        private readonly FirestoreDb _firestoreDb = firestoreDb;

        [HttpPost]
        public async Task<IActionResult> PostHeartbeat([FromBody] HealthCheck heartbeat)
        {
            if (heartbeat == null)
            {
                return BadRequest("Invalid heartbeat data");
            }

            try
            {
                var configResponse = new
                {
                    DeviceId = heartbeat.DeviceId,
                    Tracking = new TrackingConfig
                    {
                        Enabled = true,
                        Model = "yolov8n",
                        ConfidenceThreshold = 0.5,
                        MaxFps = 30
                    },
                    Camera = new CameraConfig
                    {
                        Resolution = "1920x1080",
                        Framerate = 30,
                        Codec = "h264"
                    },
                    HeartbeatInterval = 60,
                    Version = "1.2.3"
                };

                return Ok(configResponse);
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }
    }
}
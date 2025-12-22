using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using Google.Cloud.Firestore;

using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
	[ApiController]
	[Route("api/[controller]")]
    public class DeviceController(DeviceService deviceService) : ControllerBase
    {
        private readonly DeviceService _deviceService = deviceService;

        [HttpGet]
        public IActionResult GetDevices()
        {
            try
            {
                List<Device> response = _deviceService.GetDevices();
                return Ok(response);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while retrieving devices.");
            }
        }

        [HttpGet("{id}")]
        public IActionResult GetDevice(string id)
        {
            try
            {
                Device? response = _deviceService.GetDevice(id);
                if (response == null)
                    return NotFound();
                return Ok(response);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while retrieving the device.");
            }
        }

        [HttpPost]
		public IActionResult AddDevice([FromBody] Device device)
		{
			if (device == null)
				return BadRequest();

			try
			{
				var created = _deviceService.AddDevice(device);
				return CreatedAtAction(nameof(GetDevice), new { id = created?.Id }, created);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while adding the device.");
			}
		}

        [HttpPut("{id}")]
		public IActionResult UpdateDevice(string id, [FromBody] Device device)
		{
			if (device == null || id != device.Id)
				return BadRequest();

			try
			{
				var updated = _deviceService.UpdateDevice(id, device);
				if (updated == null)
					return NotFound();
				return Ok(updated);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while updating the user.");
			}
		}

		[HttpDelete("{id}")]
		public IActionResult DeleteDevice(string id)
		{
			try
			{
				var deleted = _deviceService.DeleteDevice(id);
				if (!deleted)
					return NotFound();
				return NoContent();
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while deleting the user.");
			}
		}
    }
}
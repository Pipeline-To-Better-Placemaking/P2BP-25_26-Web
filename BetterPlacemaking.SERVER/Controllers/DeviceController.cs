using BetterPlacemaking.Models;
using BetterPlacemaking.Models.Dtos;
using BetterPlacemaking.Models.JetsonDTOs;
using BetterPlacemaking.Services;
using Google.Cloud.Firestore;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
	[ApiController]
	[Route("api/[controller]")]
    public class DeviceController(DeviceService deviceService) : ControllerBase
    {
        private readonly DeviceService _deviceService = deviceService;

        [HttpGet]
		[Authorize(Policy = "UserJwt")]
        public IActionResult GetDevices()
        {
            try
            {
				List<Device> devices = _deviceService.GetDevices();
				var dtos = devices.Select(ToDto).ToList();
				return Ok(dtos);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while retrieving devices.");
            }
        }

        [HttpGet("{id}")]
		[Authorize(Policy = "UserJwt")]
        public IActionResult GetDevice(string id)
        {
            try
            {
				Device? device = _deviceService.GetDevice(id);
				if (device == null)
                    return NotFound();
				return Ok(ToDto(device));
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while retrieving the device.");
            }
        }

		[HttpPost]
		[Authorize(Policy = "UserJwt")]
		public IActionResult AddDevice([FromBody] DeviceDto deviceDto)
		{
			if (deviceDto == null)
				return BadRequest();

			try
			{
				var created = _deviceService.AddDevice(FromDto(deviceDto));
				return CreatedAtAction(nameof(GetDevice), new { id = created?.Id }, ToDto(created!));
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while adding the device.");
			}
		}

		[HttpPut("{id}")]
		[Authorize(Policy = "UserJwt")]
		public IActionResult UpdateDevice(string id, [FromBody] DeviceDto deviceDto)
		{
			if (deviceDto == null || id != deviceDto.Id)
				return BadRequest();

			try
			{
				var updated = _deviceService.UpdateDevice(id, FromDto(deviceDto));
				if (updated == null)
					return NotFound();
				return Ok(ToDto(updated));
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while updating the user.");
			}
		}

		[HttpDelete("{id}")]
		[Authorize(Policy = "UserJwt")]
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

		[HttpPost("heartbeat")]
		[Authorize(Policy = "DeviceApiKey")]
		public IActionResult PostHeartbeat([FromBody] HealthReport heartbeat)
		{
			if (heartbeat == null)
				return BadRequest("Invalid heartbeat data");

			try
			{
                if (HttpContext.Items["Device"] is not Device device)
                    return Unauthorized("Invalid API key");

				if (string.IsNullOrWhiteSpace(device.Id))
					return Unauthorized("Invalid device");

				var updated = _deviceService.UpdateDeviceHealthReport(device.Id, heartbeat);
				if (!updated)
					return NotFound("Device not found");

                return Ok(device.Config);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while processing the heartbeat.");
			}
		}

		[HttpPost("{id}/apikey")]
		[Authorize(Policy = "UserJwt")]
		public IActionResult GenerateApiKey(string id)
		{
			try
			{
				var apiKey = _deviceService.GenerateAndUpdateApiKey(id);
				if (apiKey == null)
					return NotFound();

				return Ok(new { ApiKey = apiKey });
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while generating the API key.");
			}
		}

		private static DeviceDto ToDto(Device device) => new()
		{
			Id = device.Id,
			ProjectId = device.ProjectId,
			Name = device.Name,
			Config = device.Config,
			HealthReport = device.HealthReport,
		};

		private static Device FromDto(DeviceDto dto) => new()
		{
			Id = dto.Id,
			ProjectId = dto.ProjectId,
			Name = dto.Name,
			Config = dto.Config,
		};
	}
}
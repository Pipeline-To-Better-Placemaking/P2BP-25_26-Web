using BetterPlacemaking.Models;
using BetterPlacemaking.Models.Dtos;
using BetterPlacemaking.Models.JetsonDTOs;
using BetterPlacemaking.Services;
using BetterPlacemaking.Authorization;
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

		[HttpGet("project/{projectId}")]
		[RequirePermission(Permissions.Project.DevicesRead)]
		public IActionResult GetDevicesByProject([FromRoute] string projectId)
		{
			if (string.IsNullOrWhiteSpace(projectId))
				return BadRequest();

			try
			{
				List<Device> devices = _deviceService.GetDevicesByProjectId(projectId);
				var dtos = devices.Select(ToDto).ToList();
				return Ok(dtos);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while retrieving project devices.");
			}
		}

		[HttpGet("project/{projectId}/{id}")]
		[RequirePermission(Permissions.Project.DevicesRead)]
		public IActionResult GetDevice(string projectId, string id)
        {
            try
            {
				Device? device = _deviceService.GetDevice(id);
				if (device == null)
                    return NotFound();

				if (!string.Equals(device.ProjectId, projectId, StringComparison.OrdinalIgnoreCase))
					return NotFound();

				return Ok(ToDto(device));
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while retrieving the device.");
            }
        }

		[HttpPost("project/{projectId}")]
		[RequirePermission(Permissions.Project.DevicesManage)]
		public IActionResult AddDevice([FromRoute] string projectId, [FromBody] DeviceDto deviceDto)
		{
			if (deviceDto == null)
				return BadRequest();

			if (string.IsNullOrWhiteSpace(projectId))
				return BadRequest();

			deviceDto.ProjectId = projectId;

			try
			{
				var created = _deviceService.AddDevice(FromDto(deviceDto));
				return CreatedAtAction(nameof(GetDevice), new { projectId, id = created?.Id }, ToDto(created!));
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while adding the device.");
			}
		}

		[HttpPut("project/{projectId}/{id}")]
		[RequirePermission(Permissions.Project.DevicesManage)]
		public IActionResult UpdateDevice(string projectId, string id, [FromBody] DeviceDto deviceDto)
		{
			if (deviceDto == null || id != deviceDto.Id)
				return BadRequest();

			if (string.IsNullOrWhiteSpace(projectId))
				return BadRequest();

			deviceDto.ProjectId = projectId;

			try
			{
				var existing = _deviceService.GetDevice(id);
				if (existing == null)
					return NotFound();

				if (!string.Equals(existing.ProjectId, projectId, StringComparison.OrdinalIgnoreCase))
					return NotFound();

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

		[HttpDelete("project/{projectId}/{id}")]
		[RequirePermission(Permissions.Project.DevicesManage)]
		public IActionResult DeleteDevice(string projectId, string id)
		{
			try
			{
				var existing = _deviceService.GetDevice(id);
				if (existing == null)
					return NotFound();

				if (!string.Equals(existing.ProjectId, projectId, StringComparison.OrdinalIgnoreCase))
					return NotFound();

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
                if (HttpContext.Items["Device"] is not Device device || string.IsNullOrWhiteSpace(device.Id))
                    return Unauthorized("Invalid API key");

				var config = _deviceService.UpdateDeviceHealthReport(device, heartbeat);
				if (config == null)
					return NotFound("Device not found");

				config.ProjectId = device.ProjectId;
				return Ok(config);
			}
			catch (Exception)
			{
				return Problem("An unexpected error occurred while processing the heartbeat.");
			}
		}

		[HttpPost("project/{projectId}/{id}/apikey")]
		[RequirePermission(Permissions.Project.DevicesManage)]
		public IActionResult GenerateApiKey(string projectId, string id)
		{
			try
			{
				var existing = _deviceService.GetDevice(id);
				if (existing == null)
					return NotFound();

				if (!string.Equals(existing.ProjectId, projectId, StringComparison.OrdinalIgnoreCase))
					return NotFound();

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
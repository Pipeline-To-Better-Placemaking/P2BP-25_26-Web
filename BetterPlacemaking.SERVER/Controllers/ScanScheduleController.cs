using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BetterPlacemaking.Models;
using BetterPlacemaking.Services;

namespace BetterPlacemaking.Controllers;

[ApiController]
[Route("api/scan-schedule")]
[Authorize(Policy = "UserJwt")]
public class ScanScheduleController(ScanScheduleService scheduleService) : ControllerBase
{
    private readonly ScanScheduleService _scheduleService = scheduleService;

    [HttpPost("{projectId}")]
    public IActionResult Create(string projectId, [FromBody] ScanSchedule schedule)
    {
        try
        {
            var result = _scheduleService.CreateSchedule(projectId, schedule);
            return Ok(result);
        }
        catch (Exception)
        {
            return Problem("Failed to create scan schedule.");
        }
    }

    [HttpGet("{projectId}")]
    public IActionResult GetAll(string projectId)
    {
        try
        {
            var schedules = _scheduleService.GetSchedules(projectId);
            return Ok(schedules);
        }
        catch (Exception)
        {
            return Problem("Failed to load scan schedules.");
        }
    }

    [HttpDelete("{projectId}/{scheduleId}")]
    public IActionResult Delete(string projectId, string scheduleId)
    {
        try
        {
            var deleted = _scheduleService.DeleteSchedule(projectId, scheduleId);
            return deleted ? NoContent() : NotFound();
        }
        catch (Exception)
        {
            return Problem("Failed to delete scan schedule.");
        }
    }

    [HttpPut("{projectId}/{scheduleId}")]
    public IActionResult Update(string projectId, string scheduleId, [FromBody] ScanSchedule schedule)
    {
        try
        {
            var updated = _scheduleService.UpdateSchedule(projectId, scheduleId, schedule);
            return updated ? NoContent() : NotFound();
        }
        catch (Exception)
        {
            return Problem("Failed to update scan schedule.");
        }
    }
}

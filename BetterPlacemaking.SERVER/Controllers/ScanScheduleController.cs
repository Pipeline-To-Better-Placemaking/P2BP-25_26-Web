using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using BetterPlacemaking.Authorization;

namespace BetterPlacemaking.Controllers;

[ApiController]
[Route("api/scan-schedule")]
[Authorize(Policy = "UserJwt")]
public class ScanScheduleController(ScanScheduleService scheduleService) : ControllerBase
{
    private readonly ScanScheduleService _scheduleService = scheduleService;

    [HttpPost("{projectId}")]
    [RequirePermission(Permissions.Project.ScanSchedulesManage)]
    public IActionResult Create(string projectId, [FromBody] ScanSchedule schedule)
    {
        try
        {
            var userId = ResolveCurrentUserId();
            var result = _scheduleService.CreateSchedule(projectId, schedule, userId);
            return Ok(result);
        }
        catch (Exception)
        {
            return Problem("Failed to create scan schedule.");
        }
    }

    [HttpGet("{projectId}")]
    [RequirePermission(Permissions.Project.ScanSchedulesRead)]
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
    [RequirePermission(Permissions.Project.ScanSchedulesManage)]
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
    [RequirePermission(Permissions.Project.ScanSchedulesManage)]
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

    private string? ResolveCurrentUserId()
    {
        return
            User.FindFirstValue(ClaimTypes.NameIdentifier) ??
            User.FindFirstValue("userId") ??
            User.FindFirstValue("uid") ??
            User.FindFirstValue("id");
    }
}

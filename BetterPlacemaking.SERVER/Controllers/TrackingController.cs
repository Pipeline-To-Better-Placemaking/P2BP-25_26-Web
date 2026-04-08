using BetterPlacemaking.Models.Tracking;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers;

/// <summary>Endpoints aligned with P2BP-25_26-Visualizer GalleryModelApi tracking minimal APIs.</summary>
[ApiController]
[Route("api/tracking")]
public class TrackingController : ControllerBase
{
    private readonly TrackingDataService _tracking;

    public TrackingController(TrackingDataService tracking)
    {
        _tracking = tracking;
    }

    [HttpGet("positions")]
    public ActionResult<List<TrackingPosition>> Positions([FromQuery] int? limit)
    {
        return Ok(_tracking.GetRecentPositions(limit ?? 1000));
    }

    [HttpGet("tracks")]
    public ActionResult<List<TrackingPath>> Tracks()
    {
        return Ok(_tracking.GetAllTracks());
    }

    [HttpGet("tracks/{globalId:int}")]
    public ActionResult<TrackingPath> TrackByGlobalId(int globalId)
    {
        var track = _tracking.GetTrackByGlobalId(globalId);
        return track != null ? Ok(track) : NotFound(new { error = $"Track with global ID {globalId} not found" });
    }

    [HttpGet("active")]
    public IActionResult Active([FromQuery] int? seconds)
    {
        return Ok(_tracking.GetActiveTracks(seconds ?? 30));
    }
}

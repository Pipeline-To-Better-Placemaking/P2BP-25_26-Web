using BetterPlacemaking.Services.Rplidar;
using Microsoft.AspNetCore.Mvc;
using System.Numerics;
using IOPath = System.IO.Path;

namespace BetterPlacemaking.Controllers;

/// <summary>
/// Ported from P2BP-25_26-Visualizer GalleryModelApi/Controllers/RplidarController.cs
/// plus GET from-scan wired to the visualizer session point cloud.
/// </summary>
[ApiController]
[Route("api/rplidar")]
public class RplidarController : ControllerBase
{
    private readonly RplidarScanService _scanService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<RplidarController> _logger;

    public RplidarController(
        RplidarScanService scanService,
        IConfiguration configuration,
        ILogger<RplidarController> logger)
    {
        _scanService = scanService;
        _configuration = configuration;
        _logger = logger;
    }

    private string ScanDirectory =>
        _configuration.GetValue<string>("RplidarScan:ScanDirectory")
        ?? IOPath.Combine(Directory.GetCurrentDirectory(), "Data", "rplidar_scans");

    [HttpGet("scans")]
    public IActionResult ListScans()
    {
        if (!Directory.Exists(ScanDirectory))
            return Ok(Array.Empty<object>());

        var scans = Directory.GetFiles(ScanDirectory, "*.xyz")
            .Select(f => new
            {
                filename = IOPath.GetFileName(f),
                sizeBytes = new FileInfo(f).Length,
                modified = new FileInfo(f).LastWriteTimeUtc
            })
            .OrderByDescending(s => s.modified)
            .ToList();

        return Ok(scans);
    }

    [HttpGet("scans/{filename}")]
    public IActionResult GetScan(
        string filename,
        [FromQuery] double? floorThreshold,
        [FromQuery] double? ceilingThreshold,
        [FromQuery] int maxFloorPoints = 1500,
        [FromQuery] int maxCeilingPoints = 800)
    {
        var filePath = IOPath.Combine(ScanDirectory, filename);
        if (!System.IO.File.Exists(filePath))
            return NotFound(new { error = $"Scan file '{filename}' not found" });

        var result = _scanService.ParseXyzFile(filePath);

        var floorSub = Subsample(result.Floor, maxFloorPoints);
        var ceilSub = Subsample(result.Ceiling, maxCeilingPoints);
        var wallSub = Subsample(result.WallPoints, 3000);

        return Ok(new
        {
            floor = floorSub.Select(p => new[] { Math.Round(p.X, 2), Math.Round(p.Y, 2) }),
            obstacles = result.Obstacles.Select(p => new[] {
                Math.Round(p.X, 2), Math.Round(p.Y, 2), Math.Round(p.Z, 2)
            }),
            clusterPoints = result.ClusterPoints.Select(p => new[] {
                Math.Round(p.X, 2), Math.Round(p.Y, 2), Math.Round(p.Z, 2)
            }),
            ceiling = ceilSub.Select(p => new[] { Math.Round(p.X, 2), Math.Round(p.Y, 2) }),
            wallPoints = wallSub.Select(p => new[] { Math.Round(p.X, 2), Math.Round(p.Y, 2) }),
            clusters = result.Clusters,
            meta = result.Meta
        });
    }

    [HttpGet("scans/{filename}/obstacles")]
    public IActionResult GetObstacles(string filename)
    {
        var filePath = IOPath.Combine(ScanDirectory, filename);
        if (!System.IO.File.Exists(filePath))
            return NotFound(new { error = $"Scan file '{filename}' not found" });

        var result = _scanService.ParseXyzFile(filePath);
        return Ok(result.Clusters);
    }

    [HttpGet("scans/{filename}/floorplan")]
    public IActionResult GetFloorplan(string filename)
    {
        var filePath = IOPath.Combine(ScanDirectory, filename);
        if (!System.IO.File.Exists(filePath))
            return NotFound(new { error = $"Scan file '{filename}' not found" });

        var result = _scanService.ParseXyzFile(filePath);

        double fMinX = double.MaxValue, fMaxX = double.MinValue;
        double fMinY = double.MaxValue, fMaxY = double.MinValue;
        foreach (var p in result.Floor)
        {
            if (p.X < fMinX) fMinX = p.X;
            if (p.X > fMaxX) fMaxX = p.X;
            if (p.Y < fMinY) fMinY = p.Y;
            if (p.Y > fMaxY) fMaxY = p.Y;
        }

        return Ok(new
        {
            floorBounds = new
            {
                minX = Math.Round(fMinX, 2), maxX = Math.Round(fMaxX, 2),
                minY = Math.Round(fMinY, 2), maxY = Math.Round(fMaxY, 2)
            },
            obstacles = result.Clusters.Select(c => new
            {
                c.Id, c.Type, c.CenterX, c.CenterY,
                c.MinX, c.MaxX, c.MinY, c.MaxY,
                c.Width, c.Depth, c.AvgHeight, c.MaxHeight
            }),
            meta = result.Meta
        });
    }

    [HttpPost("upload")]
    public async Task<IActionResult> UploadScan(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided" });

        if (!file.FileName.EndsWith(".xyz", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { error = "Only .xyz files are supported" });

        Directory.CreateDirectory(ScanDirectory);
        var destPath = IOPath.Combine(ScanDirectory, file.FileName);

        await using (var stream = new FileStream(destPath, FileMode.Create))
        {
            await file.CopyToAsync(stream);
        }

        _logger.LogInformation("Uploaded scan: {Filename} ({Size} bytes)", file.FileName, file.Length);

        var result = _scanService.ParseXyzFile(destPath);
        return Ok(new
        {
            filename = file.FileName,
            meta = result.Meta,
            clusterCount = result.Clusters.Count
        });
    }

    /// <summary>Object detection from current visualizer point cloud (same as GalleryModelApi /api/rplidar/from-scan).</summary>
    [HttpGet("from-scan")]
    public IActionResult FromScan([FromQuery] int maxFloorPoints = 1500, [FromQuery] int maxCeilingPoints = 800)
    {
        var points = VisualizerController.SnapshotCurrentPointsForRplidar();
        if (points.Count == 0)
            return NotFound(new { error = "No point cloud loaded. Upload a scan or load a room in the 3D view first." });

        try
        {
            var result = _scanService.ParseFromPointCloud(points);
            var floorSub = result.Floor.Count <= maxFloorPoints ? result.Floor : Enumerable.Range(0, maxFloorPoints)
                .Select(i => result.Floor[(int)((double)i * result.Floor.Count / maxFloorPoints)]).ToList();
            var ceilSub = result.Ceiling.Count <= maxCeilingPoints ? result.Ceiling : Enumerable.Range(0, maxCeilingPoints)
                .Select(i => result.Ceiling[(int)((double)i * result.Ceiling.Count / maxCeilingPoints)]).ToList();
            var wallSub = result.WallPoints.Count <= 3000 ? result.WallPoints : Enumerable.Range(0, 3000)
                .Select(i => result.WallPoints[(int)((double)i * result.WallPoints.Count / 3000)]).ToList();

            return Ok(new
            {
                floor = floorSub.Select(p => new[] { Math.Round(p.X, 2), Math.Round(p.Y, 2) }),
                obstacles = result.Obstacles.Select(p => new[] { Math.Round(p.X, 2), Math.Round(p.Y, 2), Math.Round(p.Z, 2) }),
                clusterPoints = result.ClusterPoints.Select(p => new[] { Math.Round(p.X, 2), Math.Round(p.Y, 2), Math.Round(p.Z, 2) }),
                ceiling = ceilSub.Select(p => new[] { Math.Round(p.X, 2), Math.Round(p.Y, 2) }),
                wallPoints = wallSub.Select(p => new[] { Math.Round(p.X, 2), Math.Round(p.Y, 2) }),
                clusters = result.Clusters,
                meta = result.Meta
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "from-scan failed");
            return BadRequest(new { error = ex.Message });
        }
    }

    private static List<Vector2> Subsample(List<Vector2> points, int maxCount)
    {
        if (points.Count <= maxCount) return points;
        var result = new List<Vector2>(maxCount);
        var step = (double)points.Count / maxCount;
        for (var i = 0; i < maxCount; i++)
            result.Add(points[(int)(i * step)]);
        return result;
    }
}

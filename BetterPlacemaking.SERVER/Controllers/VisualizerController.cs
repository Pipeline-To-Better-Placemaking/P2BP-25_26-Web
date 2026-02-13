using BetterPlacemaking.Models.Visualizer;
using BetterPlacemaking.Services.Visualizer;
using Microsoft.AspNetCore.Mvc;
using IOPath = System.IO.Path;

namespace BetterPlacemaking.Controllers;

/// <summary>
/// Controller for 3D point cloud visualization, mesh generation, and geometry export.
/// Ported from P2BP-25_26-Visualizer's GalleryModelApi.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class VisualizerController : ControllerBase
{
    private readonly PointCloudService _pointCloudService;
    private readonly GeometryCalculationService _geometryService;
    private readonly ObjParserService _objParser;
    private readonly XyzParserService _xyzParser;
    private readonly MeshGenerationService _meshService;
    private readonly FastMeshService _fastMeshService;
    private readonly GeometryExportService _exportService;
    private readonly PlyParserService _plyParser;
    private readonly IWebHostEnvironment _env;

    // In-memory point cloud storage (session-based, not persisted)
    private static List<LidarPoint3D> _currentPoints = new();
    private static Models.Visualizer.Mesh? _currentMesh = null;
    private static readonly object _lock = new();

    public VisualizerController(
        PointCloudService pointCloudService,
        GeometryCalculationService geometryService,
        ObjParserService objParser,
        XyzParserService xyzParser,
        MeshGenerationService meshService,
        FastMeshService fastMeshService,
        GeometryExportService exportService,
        PlyParserService plyParser,
        IWebHostEnvironment env)
    {
        _pointCloudService = pointCloudService;
        _geometryService = geometryService;
        _objParser = objParser;
        _xyzParser = xyzParser;
        _meshService = meshService;
        _fastMeshService = fastMeshService;
        _exportService = exportService;
        _plyParser = plyParser;
        _env = env;
    }

    // ─── Point Cloud Endpoints ───────────────────────────────────────────

    /// <summary>
    /// Get the current 3D point cloud data.
    /// </summary>
    [HttpGet("points")]
    public IActionResult GetPoints()
    {
        lock (_lock)
        {
            return Ok(_currentPoints);
        }
    }

    /// <summary>
    /// Upload scanner data as JSON points.
    /// </summary>
    [HttpPost("scanner/upload")]
    public IActionResult UploadScannerData([FromBody] ScannerUploadRequest request)
    {
        if (request.Points == null || request.Points.Count == 0)
            return BadRequest("No points provided");

        try
        {
            var points = new List<LidarPoint3D>();
            var convertFromMm = request.ConvertFromMillimeters ?? true;
            var scaleFactor = convertFromMm ? 0.1 : 1.0;

            foreach (var point in request.Points)
            {
                var x = point.X * scaleFactor;
                var y = point.Y * scaleFactor;
                var z = point.Z * scaleFactor;

                int r = point.R ?? 150;
                int g = point.G ?? 150;
                int b = point.B ?? 150;

                var intensity = (r + g + b) / 3.0 / 255.0;
                var color = $"#{r:X2}{g:X2}{b:X2}";

                points.Add(new LidarPoint3D
                {
                    X = x,
                    Y = y,
                    Z = z,
                    Intensity = point.Intensity ?? intensity,
                    Classification = 0,
                    Color = color,
                    Timestamp = DateTime.UtcNow,
                    SensorId = request.SensorId ?? "rplidar"
                });
            }

            Models.Visualizer.Mesh? generatedMesh = null;
            lock (_lock)
            {
                _currentPoints = points;
                _currentMesh = null;

                if (points.Count >= 3)
                {
                    try
                    {
                        generatedMesh = _fastMeshService.CreateWatertightMesh(points, targetMeshPoints: 20000);
                        _currentMesh = generatedMesh;
                    }
                    catch (Exception meshEx)
                    {
                        Console.WriteLine($"Warning: Failed to generate mesh: {meshEx.Message}");
                    }
                }
            }

            return Ok(new
            {
                pointCount = points.Count,
                meshGenerated = generatedMesh != null,
                meshVertexCount = generatedMesh?.VertexCount ?? 0,
                meshFaceCount = generatedMesh?.FaceCount ?? 0,
                message = "Point cloud uploaded successfully."
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// Upload an OBJ file and extract point cloud.
    /// </summary>
    [HttpPost("upload/obj")]
    [DisableRequestSizeLimit]
    public async Task<IActionResult> UploadObjFile(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest("No file uploaded");

        if (!file.FileName.EndsWith(".obj", StringComparison.OrdinalIgnoreCase))
            return BadRequest("File must be an OBJ file");

        var uploadsDir = IOPath.Combine(_env.ContentRootPath, "uploads", "visualizer");
        Directory.CreateDirectory(uploadsDir);

        var fileName = $"{Guid.NewGuid()}_{file.FileName}";
        var filePath = IOPath.Combine(uploadsDir, fileName);

        try
        {
            using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            using (var stream = new FileStream(filePath, FileMode.Open))
            {
                var meshData = _objParser.ParseObjFile(stream);
                stream.Position = 0;
                var pointCloud = _objParser.ExtractPointCloudFromObj(stream);

                lock (_lock)
                {
                    _currentPoints = pointCloud;
                    _currentMesh = null;

                    if (pointCloud.Count >= 3)
                    {
                        try
                        {
                            _currentMesh = _fastMeshService.CreateWatertightMesh(pointCloud, targetMeshPoints: 20000);
                        }
                        catch (Exception meshEx)
                        {
                            Console.WriteLine($"Warning: Failed to generate mesh from OBJ: {meshEx.Message}");
                        }
                    }
                }

                return Ok(new
                {
                    fileName,
                    vertexCount = meshData.Vertices.Count,
                    faceCount = meshData.Faces.Count,
                    pointCloudCount = pointCloud.Count
                });
            }
        }
        finally
        {
            // Clean up uploaded file
            try { if (System.IO.File.Exists(filePath)) System.IO.File.Delete(filePath); }
            catch { }
        }
    }

    /// <summary>
    /// Upload XYZ file(s) from RPLidar scanner.
    /// </summary>
    [HttpPost("upload/xyz")]
    [DisableRequestSizeLimit]
    public async Task<IActionResult> UploadXyzFile(IFormFile? fileA, IFormFile? fileB, [FromQuery] string? sensorId)
    {
        if (fileA == null && fileB == null)
            return BadRequest("At least one .xyz file must be uploaded");

        var uploadsDir = IOPath.Combine(_env.ContentRootPath, "uploads", "visualizer");
        Directory.CreateDirectory(uploadsDir);

        string? filePathA = null;
        string? filePathB = null;

        try
        {
            if (fileA != null)
            {
                var fileNameA = $"{Guid.NewGuid()}_{fileA.FileName}";
                filePathA = IOPath.Combine(uploadsDir, fileNameA);
                using var stream = new FileStream(filePathA, FileMode.Create);
                await fileA.CopyToAsync(stream);
            }

            if (fileB != null)
            {
                var fileNameB = $"{Guid.NewGuid()}_{fileB.FileName}";
                filePathB = IOPath.Combine(uploadsDir, fileNameB);
                using var stream = new FileStream(filePathB, FileMode.Create);
                await fileB.CopyToAsync(stream);
            }

            var points = _xyzParser.ParseXyzFiles(filePathA!, filePathB, sensorId);

            if (points.Count == 0)
                return BadRequest("No valid points found in .xyz files");

            Models.Visualizer.Mesh? generatedMesh = null;
            lock (_lock)
            {
                _currentPoints = points;
                _currentMesh = null;

                if (points.Count >= 3)
                {
                    try
                    {
                        generatedMesh = _fastMeshService.CreateWatertightMesh(points, targetMeshPoints: 20000);
                        _currentMesh = generatedMesh;
                    }
                    catch (Exception meshEx)
                    {
                        Console.WriteLine($"Warning: Failed to generate mesh: {meshEx.Message}");
                    }
                }
            }

            return Ok(new
            {
                pointCount = points.Count,
                meshGenerated = generatedMesh != null,
                meshVertexCount = generatedMesh?.VertexCount ?? 0,
                meshFaceCount = generatedMesh?.FaceCount ?? 0,
                message = "Point cloud loaded from .xyz files."
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        finally
        {
            try
            {
                if (filePathA != null && System.IO.File.Exists(filePathA)) System.IO.File.Delete(filePathA);
                if (filePathB != null && System.IO.File.Exists(filePathB)) System.IO.File.Delete(filePathB);
            }
            catch { }
        }
    }

    /// <summary>
    /// Upload a PLY file (ASCII format with x, y, z, r, g, b).
    /// </summary>
    [HttpPost("upload/ply")]
    [DisableRequestSizeLimit]
    public IActionResult UploadPlyFile(IFormFile file, [FromQuery] int maxPoints = 0)
    {
        if (file == null || file.Length == 0)
            return BadRequest("No file uploaded");

        if (!file.FileName.EndsWith(".ply", StringComparison.OrdinalIgnoreCase))
            return BadRequest("File must be a PLY file");

        try
        {
            using var stream = file.OpenReadStream();
            var points = _plyParser.ParsePlyStream(stream, maxPoints: maxPoints);

            if (points.Count == 0)
                return BadRequest("No valid points found in PLY file");

            Models.Visualizer.Mesh? generatedMesh = null;
            lock (_lock)
            {
                _currentPoints = points;
                _currentMesh = null;

                if (points.Count >= 3)
                {
                    try
                    {
                        generatedMesh = _fastMeshService.CreateWatertightMesh(points, targetMeshPoints: 20000);
                        _currentMesh = generatedMesh;
                    }
                    catch (Exception meshEx)
                    {
                        Console.WriteLine($"Warning: Failed to generate mesh from PLY: {meshEx.Message}");
                    }
                }
            }

            return Ok(new
            {
                pointCount = points.Count,
                meshGenerated = generatedMesh != null,
                meshVertexCount = generatedMesh?.VertexCount ?? 0,
                meshFaceCount = generatedMesh?.FaceCount ?? 0,
                message = "Point cloud loaded from PLY file."
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    // ─── Geometry Endpoints ──────────────────────────────────────────────

    /// <summary>
    /// Calculate room geometry from current point cloud.
    /// </summary>
    [HttpGet("geometry/room")]
    public IActionResult GetRoomGeometry()
    {
        lock (_lock)
        {
            var geometry = _geometryService.CalculateFullGeometry(_currentPoints);
            return Ok(geometry);
        }
    }

    // ─── Mesh Endpoints ──────────────────────────────────────────────────

    /// <summary>
    /// Generate or retrieve mesh from point cloud.
    /// </summary>
    [HttpPost("geometry/mesh")]
    public IActionResult GenerateMesh([FromBody] MeshGenerationRequest? request)
    {
        try
        {
            var targetMeshPoints = request?.TargetMeshPoints ?? 20000;
            var alphaValue = request?.AlphaValue ?? 30.0;
            var smoothingIterations = request?.SmoothingIterations ?? 5;
            var useLegacy = request?.UseLegacy ?? false;
            var forceRegenerate = request?.ForceRegenerate ?? false;

            lock (_lock)
            {
                if (_currentMesh != null && !useLegacy && !forceRegenerate)
                {
                    var objContent = _meshService.ExportMeshToObj(_currentMesh);
                    return Content(objContent, "text/plain");
                }

                if (_currentPoints.Count == 0)
                    return BadRequest("No points available to generate mesh");

                Models.Visualizer.Mesh mesh;
                if (useLegacy)
                {
                    mesh = _meshService.CreateMeshFromPointCloud(_currentPoints);
                    mesh = _meshService.SmoothMeshLaplacian(mesh, iterations: smoothingIterations);
                    mesh = _meshService.OptimizeMesh(mesh);
                }
                else
                {
                    mesh = _fastMeshService.CreateWatertightMesh(_currentPoints, targetMeshPoints, alphaValue, smoothingIterations);
                }

                if (mesh.FaceCount == 0)
                    return BadRequest("Mesh generation produced no faces.");

                _currentMesh = mesh;

                var meshObjContent = _meshService.ExportMeshToObj(mesh);
                return Content(meshObjContent, "text/plain");
            }
        }
        catch (Exception ex)
        {
            return BadRequest($"Error generating mesh: {ex.Message}");
        }
    }

    // ─── Export Endpoints ────────────────────────────────────────────────

    [HttpGet("export/obj")]
    public IActionResult ExportObj()
    {
        lock (_lock)
        {
            var content = _exportService.ExportPointCloudToObj(_currentPoints);
            return Content(content, "text/plain");
        }
    }

    [HttpGet("export/csv")]
    public IActionResult ExportCsv()
    {
        lock (_lock)
        {
            var content = _exportService.ExportToCsv(_currentPoints);
            return Content(content, "text/csv");
        }
    }

    [HttpGet("export/xyz")]
    public IActionResult ExportXyz()
    {
        lock (_lock)
        {
            if (_currentPoints.Count == 0)
                return BadRequest("No point cloud loaded.");
            var content = _exportService.ExportToXyz(_currentPoints);
            return Content(content, "text/plain");
        }
    }

    [HttpGet("export/xyz-rgb")]
    public IActionResult ExportXyzRgb()
    {
        lock (_lock)
        {
            if (_currentPoints.Count == 0)
                return BadRequest("No point cloud loaded.");
            var content = _exportService.ExportToXyzRgb(_currentPoints);
            return Content(content, "text/plain");
        }
    }

    [HttpGet("export/txt")]
    public IActionResult ExportTxt()
    {
        lock (_lock)
        {
            if (_currentPoints.Count == 0)
                return BadRequest("No point cloud loaded.");
            var content = _exportService.ExportToTxt(_currentPoints);
            return Content(content, "text/plain");
        }
    }

    [HttpGet("export/pts")]
    public IActionResult ExportPts()
    {
        lock (_lock)
        {
            if (_currentPoints.Count == 0)
                return BadRequest("No point cloud loaded.");
            var content = _exportService.ExportToPts(_currentPoints);
            return Content(content, "text/plain");
        }
    }

    [HttpGet("export/ply")]
    public IActionResult ExportPly()
    {
        lock (_lock)
        {
            if (_currentPoints.Count == 0)
                return BadRequest("No point cloud loaded.");
            var content = _exportService.ExportToPly(_currentPoints);
            return Content(content, "text/plain");
        }
    }

    [HttpGet("export/geometry/json")]
    public IActionResult ExportGeometryJson()
    {
        lock (_lock)
        {
            var geometry = _geometryService.CalculateFullGeometry(_currentPoints);
            var content = _exportService.ExportGeometryToJson(geometry);
            return Content(content, "application/json");
        }
    }

    /// <summary>
    /// Clear the current point cloud and mesh data.
    /// </summary>
    [HttpDelete("points")]
    public IActionResult ClearPoints()
    {
        lock (_lock)
        {
            _currentPoints.Clear();
            _currentMesh = null;
            return Ok(new { message = "Point cloud cleared." });
        }
    }
}

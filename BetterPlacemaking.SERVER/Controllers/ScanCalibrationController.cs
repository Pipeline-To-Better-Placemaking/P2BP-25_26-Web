using BetterPlacemaking.Services.ScanCombine;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/ScanCalibration")]
    public class ScanCalibrationController : ControllerBase
    {
        private readonly FirestoreDb _db;
        private readonly CombineCloudsService _combineCloudsService;
        private readonly ScanFlattenPreviewService _previewService;

        public ScanCalibrationController(
            FirestoreDb db,
            CombineCloudsService combineCloudsService,
            ScanFlattenPreviewService previewService)
        {
            _db = db;
            _combineCloudsService = combineCloudsService;
            _previewService = previewService;
        }

        [HttpGet("{projectId}/{deviceId}/{scanId}/preview")]
        public IActionResult GetPreview(string projectId, string deviceId, string scanId)
        {
            try
            {
                var xyzPath = ResolveLocalXyzPath(projectId, deviceId, scanId);
                var png = _previewService.RenderPreviewPng(xyzPath);

                return File(png, "image/png");
            }
            catch (Exception ex)
            {
                return Problem(ex.Message);
            }
        }

        [HttpPost("{projectId}/{deviceId}/upload-xyz")]
        public async Task<IActionResult> UploadXyz(string projectId, string deviceId, IFormFile file)
        {
            try
            {
                if (file == null || file.Length == 0)
                    return BadRequest("No file uploaded.");

                if (!file.FileName.EndsWith(".xyz", StringComparison.OrdinalIgnoreCase))
                    return BadRequest("Only .xyz files are allowed.");

                var tempDir = Path.Combine(Path.GetTempPath(), "bp-uploaded-xyz");
                Directory.CreateDirectory(tempDir);

                var scanId = Guid.NewGuid().ToString("N");
                var localPath = Path.Combine(tempDir, $"{scanId}.xyz");

                await using (var stream = System.IO.File.Create(localPath))
                {
                    await file.CopyToAsync(stream);
                }

                var docRef = _db
                    .Collection("projects")
                    .Document(projectId)
                    .Collection("devices")
                    .Document(deviceId)
                    .Collection("scans")
                    .Document(scanId);

                await docRef.SetAsync(new Dictionary<string, object?>
                {
                    { "Status", "complete" },
                    { "CreatedAt", Timestamp.GetCurrentTimestamp() },
                    { "StartedAt", Timestamp.GetCurrentTimestamp() },
                    { "FinishedAt", Timestamp.GetCurrentTimestamp() },
                    { "ObjUrl", localPath },
                    { "Error", null },
                    { "IsUploadedCalibrationScan", true },
                    { "OriginalFileName", file.FileName }
                });

                return Ok(new
                {
                    Id = scanId,
                    Status = "complete",
                    ObjUrl = localPath,
                    OriginalFileName = file.FileName
                });
            }
            catch (Exception ex)
            {
                return Problem(ex.Message);
            }
        }

        [HttpGet("{projectId}/{deviceId}/{scanId}/download")]
public IActionResult DownloadScanFile(string projectId, string deviceId, string scanId)
{
    try
    {
        var localPath = ResolveLocalXyzPath(projectId, deviceId, scanId);

        if (!System.IO.File.Exists(localPath))
            return NotFound("File not found.");

        var fileName = Path.GetFileName(localPath);

        return PhysicalFile(
            localPath,
            "application/octet-stream",
            fileName
        );
    }
    catch (Exception ex)
    {
        return Problem(ex.Message);
    }
}

        [HttpPost("{projectId}/{deviceId}/combine")]
        public async Task<IActionResult> CombineScans(
            string projectId,
            string deviceId,
            [FromBody] CombineScansRequest request)
        {
            try
            {
                if (request.Items == null || request.Items.Count < 2)
                    return BadRequest("At least two scans are required.");

                var inputs = request.Items.Select(item => new CombineCloudInput
                {
                    XyzFilePath = ResolveLocalXyzPath(projectId, deviceId, item.ScanId),
                    XTranslation = item.XTranslation,
                    YTranslation = item.YTranslation,
                    Theta = item.Theta
                }).ToList();

                var outputDirectory = Path.Combine(Path.GetTempPath(), "bp-combined-scans");
                Directory.CreateDirectory(outputDirectory);

                var combined = _combineCloudsService.CombineClouds(
                    inputs,
                    outputDirectory,
                    request.OutputName
                );

                var scanId = Guid.NewGuid().ToString("N");

                var docRef = _db
                    .Collection("projects")
                    .Document(projectId)
                    .Collection("devices")
                    .Document(deviceId)
                    .Collection("scans")
                    .Document(scanId);

                await docRef.SetAsync(new Dictionary<string, object?>
                {
                    { "Status", "complete" },
                    { "CreatedAt", Timestamp.GetCurrentTimestamp() },
                    { "StartedAt", Timestamp.GetCurrentTimestamp() },
                    { "FinishedAt", Timestamp.GetCurrentTimestamp() },

                    // Same storage style as uploaded calibration scans for now.
                    // Later this can become a Firebase Storage signed URL.
                    { "ObjUrl", combined.OutputFilePath },

                    { "Error", null },
                    { "IsCombinedCalibrationScan", true },
                    { "OriginalFileName", combined.OutputFileName },
                    { "OutputName", request.OutputName },
                    { "ScalarMmPerPixel", request.ScalarMmPerPixel },
                    { "SourceScanIds", request.Items.Select(i => i.ScanId).ToList() },
                    {
                        "CombineTransforms",
                        request.Items.Select(i => new Dictionary<string, object?>
                        {
                            { "ScanId", i.ScanId },
                            { "XTranslation", i.XTranslation },
                            { "YTranslation", i.YTranslation },
                            { "Theta", i.Theta }
                        }).ToList()
                    }
                });

                return Ok(new
                {
                    Id = scanId,
                    Status = "complete",
                    ObjUrl = combined.OutputFilePath,
                    OriginalFileName = combined.OutputFileName,
                    IsCombinedCalibrationScan = true
                });
            }
            catch (Exception ex)
            {
                return Problem(ex.Message);
            }
        }

        private string ResolveLocalXyzPath(string projectId, string deviceId, string scanId)
        {
            var snap = _db
                .Collection("projects")
                .Document(projectId)
                .Collection("devices")
                .Document(deviceId)
                .Collection("scans")
                .Document(scanId)
                .GetSnapshotAsync()
                .Result;

            if (!snap.Exists)
                throw new FileNotFoundException($"Scan not found: {scanId}");

            var objUrl = snap.ContainsField("ObjUrl")
                ? snap.GetValue<string>("ObjUrl")
                : null;

            if (string.IsNullOrWhiteSpace(objUrl))
                throw new FileNotFoundException($"Scan {scanId} does not have an ObjUrl.");

            // Uploaded calibration files and combined files are already local paths.
            if (System.IO.File.Exists(objUrl))
                return objUrl;

            // Normal scan files may be signed URLs.
            if (objUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                objUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                var tempDir = Path.Combine(Path.GetTempPath(), "bp-scan-calibration");
                Directory.CreateDirectory(tempDir);

                var localPath = Path.Combine(tempDir, $"{scanId}.xyz");

                if (System.IO.File.Exists(localPath))
                    return localPath;

                using var httpClient = new HttpClient();
                var bytes = httpClient.GetByteArrayAsync(objUrl).Result;
                System.IO.File.WriteAllBytes(localPath, bytes);

                return localPath;
            }

            throw new FileNotFoundException(
                $"Scan {scanId} ObjUrl is neither a valid local file nor an absolute URL: {objUrl}"
            );
        }
    }
}
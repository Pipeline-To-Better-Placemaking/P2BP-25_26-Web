using BetterPlacemaking.Models.Tracking;
using Microsoft.Extensions.Configuration;
using IOPath = System.IO.Path;
using System.Globalization;

namespace BetterPlacemaking.Services;

/// <summary>Ported from P2BP-25_26-Visualizer GalleryModelApi/Services/TrackingDataService.cs</summary>
public class TrackingDataService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<TrackingDataService>? _logger;
    private readonly CoordinateTransformService _transformService;

    public TrackingDataService(
        IConfiguration configuration,
        ILogger<TrackingDataService>? logger,
        CoordinateTransformService transformService)
    {
        _configuration = configuration;
        _logger = logger;
        _transformService = transformService;
    }

    public List<TrackingPosition> GetRecentPositions(int limit = 1000)
    {
        var csvPath = _configuration.GetValue<string>("Tracking:PositionsCsv");
        if (string.IsNullOrEmpty(csvPath) || !File.Exists(csvPath))
        {
            _logger?.LogWarning("Positions CSV file not found: {Path}", csvPath);
            return new List<TrackingPosition>();
        }

        var positions = new List<TrackingPosition>();
        var lines = File.ReadAllLines(csvPath);

        var startIndex = lines.Length > 0 && lines[0].Contains("global_id") ? 1 : 0;

        var endIndex = Math.Max(startIndex, lines.Length - limit);

        for (var i = lines.Length - 1; i >= endIndex && positions.Count < limit; i--)
        {
            var position = ParsePositionLine(lines[i]);
            if (position != null)
                positions.Insert(0, position);
        }

        return positions;
    }

    public List<TrackingPath> GetAllTracks()
    {
        var tracksDir = _configuration.GetValue<string>("Tracking:TracksDir");
        if (string.IsNullOrEmpty(tracksDir) || !Directory.Exists(tracksDir))
        {
            _logger?.LogWarning("Tracks directory not found: {Path}", tracksDir);
            return new List<TrackingPath>();
        }

        var tracks = new List<TrackingPath>();
        var jsonFiles = Directory.GetFiles(tracksDir, "*.json");

        foreach (var file in jsonFiles)
        {
            try
            {
                var track = LoadTrackFromJson(file);
                if (track != null)
                    tracks.Add(track);
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Error loading track from {File}", file);
            }
        }

        return tracks;
    }

    public TrackingPath? GetTrackByGlobalId(int globalId)
    {
        var tracks = GetAllTracks();
        return tracks.FirstOrDefault(t => t.GlobalId == globalId);
    }

    public List<object> GetActiveTracks(int seconds = 30)
    {
        var cutoffTime = DateTime.UtcNow.AddSeconds(-seconds);
        var tracks = GetAllTracks();
        var activeTracks = tracks.Where(t => t.EndTime >= cutoffTime).ToList();

        var recentPositions = GetRecentPositions(1000);

        return activeTracks.Select(track =>
        {
            var lastPoint = track.Points.OrderByDescending(p => p.Timestamp).FirstOrDefault();
            if (lastPoint != null)
            {
                var latestPos = recentPositions
                    .Where(p => p.GlobalId == track.GlobalId)
                    .OrderByDescending(p => p.Timestamp)
                    .FirstOrDefault();

                if (latestPos != null && latestPos.XGround.HasValue && latestPos.YGround.HasValue)
                {
                    return (object)new
                    {
                        globalId = track.GlobalId,
                        latestPosition = new
                        {
                            xGround = latestPos.XGround.Value,
                            yGround = latestPos.YGround.Value,
                            timestamp = latestPos.Timestamp.ToString("O")
                        }
                    };
                }
            }
            return null;
        }).Where(x => x != null).Cast<object>().ToList();
    }

    private TrackingPosition? ParsePositionLine(string line)
    {
        if (string.IsNullOrWhiteSpace(line))
            return null;

        var parts = line.Split(',');

        if (parts.Length == 11)
        {
            try
            {
                return new TrackingPosition
                {
                    GlobalId = int.Parse(parts[0]),
                    CameraId = parts[1],
                    FrameIdx = int.Parse(parts[2]),
                    Timestamp = DateTime.Parse(parts[3], CultureInfo.InvariantCulture),
                    XGround = double.TryParse(parts[4], out var xg) ? xg : null,
                    YGround = double.TryParse(parts[5], out var yg) ? yg : null,
                    X1 = double.Parse(parts[6]),
                    Y1 = double.Parse(parts[7]),
                    X2 = double.Parse(parts[8]),
                    Y2 = double.Parse(parts[9]),
                    Confidence = double.Parse(parts[10])
                };
            }
            catch
            {
                return null;
            }
        }

        if (parts.Length == 9)
        {
            try
            {
                return new TrackingPosition
                {
                    GlobalId = int.Parse(parts[0]),
                    CameraId = parts[1],
                    FrameIdx = int.Parse(parts[2]),
                    Timestamp = DateTime.Parse(parts[3], CultureInfo.InvariantCulture),
                    XGround = null,
                    YGround = null,
                    X1 = double.Parse(parts[4]),
                    Y1 = double.Parse(parts[5]),
                    X2 = double.Parse(parts[6]),
                    Y2 = double.Parse(parts[7]),
                    Confidence = double.Parse(parts[8])
                };
            }
            catch
            {
                return null;
            }
        }

        return null;
    }

    private TrackingPath? LoadTrackFromJson(string filePath)
    {
        try
        {
            var json = File.ReadAllText(filePath);
            var doc = System.Text.Json.JsonDocument.Parse(json);
            var root = doc.RootElement;

            var globalId = root.GetProperty("global_id").GetInt32();
            var localCam = root.GetProperty("local_cam").GetString() ?? "";
            var firstSeenFrame = root.GetProperty("first_seen_frame").GetInt32();
            var lastSeenFrame = root.GetProperty("last_seen_frame").GetInt32();
            var positionsArray = root.GetProperty("positions").EnumerateArray().ToList();

            var pathPoints = new List<PathPoint>();
            DateTime? startTime = null;
            DateTime? endTime = null;

            foreach (var pos in positionsArray)
            {
                _ = pos[0].GetInt32();
                _ = pos[2].GetDouble();
                _ = pos[3].GetDouble();
                var gx = pos[4].GetDouble();
                var gy = pos[5].GetDouble();

                DateTime timestamp;
                if (pos[1].ValueKind == System.Text.Json.JsonValueKind.Number)
                {
                    var unixSeconds = pos[1].GetInt64();
                    timestamp = DateTimeOffset.FromUnixTimeSeconds(unixSeconds).UtcDateTime;
                }
                else
                {
                    var timestampStr = pos[1].GetString();
                    if (string.IsNullOrEmpty(timestampStr) || !DateTime.TryParse(timestampStr, CultureInfo.InvariantCulture, DateTimeStyles.None, out timestamp))
                        continue;
                }

                var transformed = _transformService.TransformCameraToLidar(gx, gy);

                pathPoints.Add(new PathPoint
                {
                    Position = transformed,
                    Timestamp = timestamp
                });

                if (startTime == null || timestamp < startTime)
                    startTime = timestamp;
                if (endTime == null || timestamp > endTime)
                    endTime = timestamp;
            }

            if (pathPoints.Count == 0)
                return null;

            return new TrackingPath
            {
                GlobalId = globalId,
                CameraId = localCam,
                Id = IOPath.GetFileNameWithoutExtension(filePath),
                IndividualId = globalId.ToString(),
                Points = pathPoints,
                StartTime = startTime ?? DateTime.UtcNow,
                EndTime = endTime ?? DateTime.UtcNow,
                FirstSeenFrame = firstSeenFrame,
                LastSeenFrame = lastSeenFrame,
                NumDetections = pathPoints.Count
            };
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Error parsing track JSON from {File}", filePath);
            return null;
        }
    }
}

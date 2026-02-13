using BetterPlacemaking.Models.Visualizer;

namespace BetterPlacemaking.Services.Visualizer;

public class XyzParserService
{
    private const double MillimetersToCentimeters = 0.1;

    /// <summary>
    /// Parse a single .xyz file with format: x y z r g b (space-separated, millimeters)
    /// </summary>
    public List<LidarPoint3D> ParseXyzFile(string filePath, string? sensorId = null)
    {
        if (!File.Exists(filePath))
            throw new FileNotFoundException($"XYZ file not found: {filePath}");

        var points = new List<LidarPoint3D>();
        var lines = File.ReadAllLines(filePath);
        var scanTimestamp = DateTime.UtcNow;

        foreach (var line in lines)
        {
            var trimmedLine = line.Trim();
            if (string.IsNullOrEmpty(trimmedLine))
                continue;

            var parts = trimmedLine.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);

            if (parts.Length < 3)
                continue;

            try
            {
                var x = double.Parse(parts[0]) * MillimetersToCentimeters;
                var y = double.Parse(parts[1]) * MillimetersToCentimeters;
                var z = double.Parse(parts[2]) * MillimetersToCentimeters;

                int r = 150, g = 150, b = 150;
                if (parts.Length >= 6)
                {
                    r = int.Parse(parts[3]);
                    g = int.Parse(parts[4]);
                    b = int.Parse(parts[5]);
                }
                else if (parts.Length >= 4)
                {
                    var intensity = int.Parse(parts[3]);
                    r = g = b = intensity;
                }

                var pointIntensity = (r + g + b) / 3.0 / 255.0;
                var color = $"#{r:X2}{g:X2}{b:X2}";

                points.Add(new LidarPoint3D
                {
                    X = x,
                    Y = y,
                    Z = z,
                    Intensity = pointIntensity,
                    Classification = 0,
                    Color = color,
                    Timestamp = scanTimestamp,
                    SensorId = sensorId ?? "rplidar"
                });
            }
            catch (FormatException)
            {
                continue;
            }
        }

        return points;
    }

    /// <summary>
    /// Parse and merge two .xyz files (front and back hemispheres)
    /// </summary>
    public List<LidarPoint3D> ParseXyzFiles(string filePathA, string? filePathB = null, string? sensorId = null)
    {
        var points = new List<LidarPoint3D>();

        if (File.Exists(filePathA))
        {
            var pointsA = ParseXyzFile(filePathA, sensorId);
            points.AddRange(pointsA);
        }

        if (!string.IsNullOrEmpty(filePathB) && File.Exists(filePathB))
        {
            var pointsB = ParseXyzFile(filePathB, sensorId);
            points.AddRange(pointsB);
        }

        return points;
    }
}

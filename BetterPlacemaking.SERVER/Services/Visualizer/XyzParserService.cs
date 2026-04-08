using BetterPlacemaking.Models.Visualizer;

namespace BetterPlacemaking.Services.Visualizer;

/// <summary>
/// Matches P2BP-25_26-Visualizer <c>GalleryModelApi/Services/XyzParserService.cs</c>:
/// file coordinates are converted to centimeters for the API using <c>mm</c> or <c>m</c>.
/// </summary>
public class XyzParserService
{
    private const double MillimetersToCentimeters = 0.1;
    private const double MetersToCentimeters = 100.0;

    private static double GetUnitsToCmFactor(string units)
    {
        return string.Equals(units, "m", StringComparison.OrdinalIgnoreCase)
            ? MetersToCentimeters
            : MillimetersToCentimeters;
    }

    /// <summary>
    /// Parse a single .xyz file: x y z [r g b] (space-separated).
    /// Units: <c>mm</c> (default) or <c>m</c> for meter-based exports (typical RPLidar).
    /// </summary>
    public List<LidarPoint3D> ParseXyzFile(string filePath, string? sensorId = null, string units = "mm")
    {
        if (!File.Exists(filePath))
            throw new FileNotFoundException($"XYZ file not found: {filePath}");

        var factor = GetUnitsToCmFactor(units);
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
                var x = double.Parse(parts[0]) * factor;
                var y = double.Parse(parts[1]) * factor;
                var z = double.Parse(parts[2]) * factor;

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

    /// <summary>Parse and merge two .xyz files. Units: <c>mm</c> or <c>m</c>.</summary>
    public List<LidarPoint3D> ParseXyzFiles(string filePathA, string? filePathB = null, string? sensorId = null, string units = "mm")
    {
        var points = new List<LidarPoint3D>();

        if (File.Exists(filePathA))
        {
            var pointsA = ParseXyzFile(filePathA, sensorId, units);
            points.AddRange(pointsA);
        }

        if (!string.IsNullOrEmpty(filePathB) && File.Exists(filePathB))
        {
            var pointsB = ParseXyzFile(filePathB, sensorId, units);
            points.AddRange(pointsB);
        }

        return points;
    }

    public LidarPoint3D ConvertToLidarPoint3D(double x, double y, double z, int r = 150, int g = 150, int b = 150, string? sensorId = null)
    {
        x *= MillimetersToCentimeters;
        y *= MillimetersToCentimeters;
        z *= MillimetersToCentimeters;

        var pointIntensity = (r + g + b) / 3.0 / 255.0;
        var color = $"#{r:X2}{g:X2}{b:X2}";

        return new LidarPoint3D
        {
            X = x,
            Y = y,
            Z = z,
            Intensity = pointIntensity,
            Classification = 0,
            Color = color,
            Timestamp = DateTime.UtcNow,
            SensorId = sensorId ?? "rplidar"
        };
    }
}

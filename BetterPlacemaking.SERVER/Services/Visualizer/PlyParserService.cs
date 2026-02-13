using BetterPlacemaking.Models.Visualizer;

namespace BetterPlacemaking.Services.Visualizer;

/// <summary>
/// Parses ASCII PLY (Polygon File Format) files into LidarPoint3D lists.
/// Supports vertex properties: x, y, z and optional r, g, b / red, green, blue.
/// </summary>
public class PlyParserService
{
    /// <summary>
    /// Parse a PLY file stream into a list of 3D points.
    /// Coordinates are kept as-is (typically meters for Stanford datasets).
    /// </summary>
    public List<LidarPoint3D> ParsePlyStream(Stream stream, string? sensorId = null, int maxPoints = 0)
    {
        var points = new List<LidarPoint3D>();

        using var reader = new StreamReader(stream);

        // ── Parse header ───────────────────────────────────────────
        int vertexCount = 0;
        var properties = new List<string>();
        bool inHeader = true;

        while (inHeader && !reader.EndOfStream)
        {
            var line = reader.ReadLine()?.Trim();
            if (string.IsNullOrEmpty(line)) continue;

            if (line.StartsWith("element vertex"))
            {
                var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 3 && int.TryParse(parts[2], out var vc))
                    vertexCount = vc;
            }
            else if (line.StartsWith("property"))
            {
                // e.g. "property float x" or "property uchar red"
                var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 3)
                    properties.Add(parts[2].ToLowerInvariant());
            }
            else if (line == "end_header")
            {
                inHeader = false;
            }
        }

        if (vertexCount == 0) return points;

        // Determine column indices
        int xIdx = properties.IndexOf("x");
        int yIdx = properties.IndexOf("y");
        int zIdx = properties.IndexOf("z");
        int rIdx = properties.IndexOf("red");
        int gIdx = properties.IndexOf("green");
        int bIdx = properties.IndexOf("blue");

        // Some PLY files use "r", "g", "b" instead of "red", "green", "blue"
        if (rIdx < 0) rIdx = properties.IndexOf("r");
        if (gIdx < 0) gIdx = properties.IndexOf("g");
        if (bIdx < 0) bIdx = properties.IndexOf("b");

        bool hasColor = rIdx >= 0 && gIdx >= 0 && bIdx >= 0;

        if (xIdx < 0 || yIdx < 0 || zIdx < 0)
            return points; // Can't parse without x, y, z

        // Determine downsample step if maxPoints is set
        int step = 1;
        if (maxPoints > 0 && vertexCount > maxPoints)
            step = (int)Math.Ceiling((double)vertexCount / maxPoints);

        // ── Parse vertices ─────────────────────────────────────────
        int lineIndex = 0;
        while (!reader.EndOfStream && lineIndex < vertexCount)
        {
            var line = reader.ReadLine();
            if (string.IsNullOrWhiteSpace(line))
            {
                lineIndex++;
                continue;
            }

            // Downsample: skip lines not on step boundary
            if (lineIndex % step != 0)
            {
                lineIndex++;
                continue;
            }

            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < properties.Count)
            {
                lineIndex++;
                continue;
            }

            if (!double.TryParse(parts[xIdx], out var x) ||
                !double.TryParse(parts[yIdx], out var y) ||
                !double.TryParse(parts[zIdx], out var z))
            {
                lineIndex++;
                continue;
            }

            string? color = null;
            if (hasColor &&
                int.TryParse(parts[rIdx], out var r) &&
                int.TryParse(parts[gIdx], out var g) &&
                int.TryParse(parts[bIdx], out var b))
            {
                color = $"#{r:X2}{g:X2}{b:X2}";
            }

            // Convert from meters to centimeters (standard for this app)
            points.Add(new LidarPoint3D
            {
                X = x * 100.0,
                Y = y * 100.0,
                Z = z * 100.0,
                Color = color,
                Intensity = 1.0,
                Classification = 0,
                SensorId = sensorId
            });

            lineIndex++;
        }

        return points;
    }
}

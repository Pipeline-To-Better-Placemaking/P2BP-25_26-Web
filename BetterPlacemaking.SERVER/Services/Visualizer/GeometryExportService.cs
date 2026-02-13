using BetterPlacemaking.Models.Visualizer;
using System.Text;

namespace BetterPlacemaking.Services.Visualizer;

public class GeometryExportService
{
    public string ExportRoomGeometryToObj(GalleryGeometry geometry)
    {
        var sb = new StringBuilder();
        sb.AppendLine("# Room Geometry OBJ Export");
        sb.AppendLine($"# Width: {geometry.Width}, Height: {geometry.Height}, Depth: {geometry.Depth}");
        return sb.ToString();
    }

    public string ExportPointCloudToObj(List<LidarPoint3D> points)
    {
        var sb = new StringBuilder();
        sb.AppendLine("# Point Cloud OBJ Export");
        foreach (var point in points)
        {
            sb.AppendLine($"v {point.X} {point.Z} {point.Y}");
        }
        return sb.ToString();
    }

    public string ExportToCsv(List<LidarPoint3D> points)
    {
        var sb = new StringBuilder();
        sb.AppendLine("X,Y,Z,Intensity,Classification,Color");
        foreach (var point in points)
        {
            sb.AppendLine($"{point.X},{point.Y},{point.Z},{point.Intensity},{point.Classification},{point.Color ?? ""}");
        }
        return sb.ToString();
    }

    /// <summary>
    /// Export point cloud to XYZ format (space-separated, no header) for Rhino import.
    /// Coordinates in meters.
    /// </summary>
    public string ExportToXyz(List<LidarPoint3D> points)
    {
        var sb = new StringBuilder();
        foreach (var point in points)
        {
            sb.AppendLine($"{point.X / 100.0:F6} {point.Y / 100.0:F6} {point.Z / 100.0:F6}");
        }
        return sb.ToString();
    }

    /// <summary>
    /// Export point cloud to XYZ format with RGB colors for Rhino import.
    /// </summary>
    public string ExportToXyzRgb(List<LidarPoint3D> points)
    {
        var sb = new StringBuilder();
        foreach (var point in points)
        {
            var (r, g, b) = ParseColorHex(point.Color);
            sb.AppendLine($"{point.X / 100.0:F6} {point.Y / 100.0:F6} {point.Z / 100.0:F6} {r} {g} {b}");
        }
        return sb.ToString();
    }

    /// <summary>
    /// Export point cloud to TXT format for Rhino import (comma-separated, meters).
    /// </summary>
    public string ExportToTxt(List<LidarPoint3D> points)
    {
        var sb = new StringBuilder();
        foreach (var point in points)
        {
            sb.AppendLine($"{point.X / 100.0:F6},{point.Y / 100.0:F6},{point.Z / 100.0:F6}");
        }
        return sb.ToString();
    }

    /// <summary>
    /// Export point cloud to PTS format (Leica format, supported by Rhino).
    /// </summary>
    public string ExportToPts(List<LidarPoint3D> points)
    {
        var sb = new StringBuilder();
        sb.AppendLine(points.Count.ToString());

        foreach (var point in points)
        {
            var (r, g, b) = ParseColorHex(point.Color);
            var intensity = (int)(point.Intensity * 255);
            sb.AppendLine($"{point.X / 100.0:F6} {point.Y / 100.0:F6} {point.Z / 100.0:F6} {intensity} {r} {g} {b}");
        }
        return sb.ToString();
    }

    /// <summary>
    /// Export point cloud to PLY ASCII format (widely supported, includes colors).
    /// </summary>
    public string ExportToPly(List<LidarPoint3D> points)
    {
        var sb = new StringBuilder();

        sb.AppendLine("ply");
        sb.AppendLine("format ascii 1.0");
        sb.AppendLine($"element vertex {points.Count}");
        sb.AppendLine("property float x");
        sb.AppendLine("property float y");
        sb.AppendLine("property float z");
        sb.AppendLine("property uchar red");
        sb.AppendLine("property uchar green");
        sb.AppendLine("property uchar blue");
        sb.AppendLine("end_header");

        foreach (var point in points)
        {
            var (r, g, b) = ParseColorHex(point.Color);
            sb.AppendLine($"{point.X / 100.0:F6} {point.Y / 100.0:F6} {point.Z / 100.0:F6} {r} {g} {b}");
        }
        return sb.ToString();
    }

    public string ExportGeometryToJson(GalleryGeometry geometry)
    {
        return System.Text.Json.JsonSerializer.Serialize(geometry, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
    }

    private (int r, int g, int b) ParseColorHex(string? colorHex)
    {
        if (string.IsNullOrEmpty(colorHex) || !colorHex.StartsWith("#") || colorHex.Length < 7)
            return (128, 128, 128);

        try
        {
            int r = Convert.ToInt32(colorHex.Substring(1, 2), 16);
            int g = Convert.ToInt32(colorHex.Substring(3, 2), 16);
            int b = Convert.ToInt32(colorHex.Substring(5, 2), 16);
            return (r, g, b);
        }
        catch
        {
            return (128, 128, 128);
        }
    }
}

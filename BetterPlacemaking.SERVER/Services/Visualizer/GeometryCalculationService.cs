using BetterPlacemaking.Models.Visualizer;

namespace BetterPlacemaking.Services.Visualizer;

public class GeometryCalculationService
{
    public GalleryGeometry CalculateFullGeometry(List<LidarPoint3D> points)
    {
        if (points.Count == 0)
        {
            return new GalleryGeometry
            {
                Name = "Empty Room",
                Width = 0,
                Height = 0,
                Depth = 0
            };
        }

        var minX = points.Min(p => p.X);
        var maxX = points.Max(p => p.X);
        var minY = points.Min(p => p.Y);
        var maxY = points.Max(p => p.Y);
        var minZ = points.Min(p => p.Z);
        var maxZ = points.Max(p => p.Z);

        return new GalleryGeometry
        {
            Name = "Calculated Room",
            Width = maxX - minX,
            Height = maxZ - minZ,
            Depth = maxY - minY,
            Walls = new List<Wall>(),
            Objects = new List<GalleryObject>()
        };
    }
}

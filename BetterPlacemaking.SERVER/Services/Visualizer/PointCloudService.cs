using BetterPlacemaking.Models.Visualizer;

namespace BetterPlacemaking.Services.Visualizer;

public class PointCloudService
{
    public List<LidarPoint3D> Convert2DTo3D(List<LidarPoint> points2D, double defaultZ)
    {
        return points2D.Select(p => new LidarPoint3D
        {
            X = p.X,
            Y = p.Y,
            Z = defaultZ,
            Intensity = 0.8,
            Classification = 0
        }).ToList();
    }
}

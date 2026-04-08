using BetterPlacemaking.Models.Tracking;

namespace BetterPlacemaking.Services;

/// <summary>Ported from P2BP-25_26-Visualizer GalleryModelApi/Services/CoordinateTransformService.cs</summary>
public class CoordinateTransformService
{
    private readonly IConfiguration _configuration;

    public CoordinateTransformService(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public TrackingPoint3D TransformCameraToLidar(double xGround, double yGround)
    {
        var offsetX = _configuration.GetValue<double>("Tracking:OffsetX");
        var offsetY = _configuration.GetValue<double>("Tracking:OffsetY");
        var offsetZ = _configuration.GetValue<double>("Tracking:OffsetZ");
        var rotationAngle = _configuration.GetValue<double>("Tracking:RotationAngle");
        var scaleX = _configuration.GetValue<double>("Tracking:ScaleX");
        var scaleZ = _configuration.GetValue<double>("Tracking:ScaleZ");

        var scaledX = xGround * scaleX;
        var scaledZ = yGround * scaleZ;

        var angleRad = rotationAngle * Math.PI / 180.0;
        var cos = Math.Cos(angleRad);
        var sin = Math.Sin(angleRad);
        var rotatedX = scaledX * cos - scaledZ * sin;
        var rotatedZ = scaledX * sin + scaledZ * cos;

        return new TrackingPoint3D
        {
            X = rotatedX + offsetX,
            Y = offsetY,
            Z = rotatedZ + offsetZ
        };
    }
}

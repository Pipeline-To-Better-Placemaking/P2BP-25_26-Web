namespace BetterPlacemaking.Models.Tracking;

/// <summary>Ported from P2BP-25_26-Visualizer GalleryModelApi/Models/TrackingData.cs (PascalCase for Web API JSON).</summary>
public class TrackingPosition
{
    public int GlobalId { get; set; }
    public string CameraId { get; set; } = string.Empty;
    public int FrameIdx { get; set; }
    public DateTime Timestamp { get; set; }
    public double? XGround { get; set; }
    public double? YGround { get; set; }
    public double X1 { get; set; }
    public double Y1 { get; set; }
    public double X2 { get; set; }
    public double Y2 { get; set; }
    public double Confidence { get; set; }
}

public class PathPoint
{
    public TrackingPoint3D Position { get; set; } = new();
    public DateTime Timestamp { get; set; }
}

public class TrackingPoint3D
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Z { get; set; }
}

public class TrackingPath
{
    public int GlobalId { get; set; }
    public string CameraId { get; set; } = string.Empty;
    public string Id { get; set; } = string.Empty;
    public string IndividualId { get; set; } = string.Empty;
    public List<PathPoint> Points { get; set; } = new();
    public DateTime StartTime { get; set; }
    public DateTime EndTime { get; set; }
    public int FirstSeenFrame { get; set; }
    public int LastSeenFrame { get; set; }
    public int NumDetections { get; set; }
}

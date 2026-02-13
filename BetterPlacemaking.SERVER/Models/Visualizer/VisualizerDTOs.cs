namespace BetterPlacemaking.Models.Visualizer;

public class MeshGenerationRequest
{
    public int TargetMeshPoints { get; set; } = 20000;
    public double AlphaValue { get; set; } = 30.0;
    public int SmoothingIterations { get; set; } = 5;
    public bool UseLegacy { get; set; } = false;
    public bool ForceRegenerate { get; set; } = false;
}

public class ScannerPoint
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Z { get; set; }
    public double? Intensity { get; set; }
    public int? R { get; set; }
    public int? G { get; set; }
    public int? B { get; set; }
}

public class ScannerUploadRequest
{
    public List<ScannerPoint> Points { get; set; } = new();
    public string? SensorId { get; set; }
    public bool? ConvertFromMillimeters { get; set; }
}

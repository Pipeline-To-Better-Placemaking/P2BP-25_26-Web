namespace BetterPlacemaking.Models.Visualizer;

public class LidarPoint3D
{
    public double X { get; set; }           // X coordinate (cm)
    public double Y { get; set; }           // Y coordinate (depth, cm)
    public double Z { get; set; }           // Z coordinate (height, cm)
    public double Intensity { get; set; }   // Intensity value (0-1)
    public int Classification { get; set; } // Point classification
    public string? Color { get; set; }       // Hex color (#RRGGBB)
    public DateTime? Timestamp { get; set; } // Optional timestamp
    public string? SensorId { get; set; }    // Optional sensor ID
}

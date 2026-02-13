namespace BetterPlacemaking.Models.Visualizer;

public class GalleryGeometry
{
    public string Name { get; set; } = string.Empty;
    public double Width { get; set; }
    public double Height { get; set; }
    public double Depth { get; set; }
    public List<Wall> Walls { get; set; } = new();
    public List<GalleryObject> Objects { get; set; } = new();
}

public class Wall
{
    public string Id { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public Point3D Position { get; set; } = new();
    public double Width { get; set; }
    public double Height { get; set; }
    public double Thickness { get; set; }
    public bool IsMovable { get; set; }
}

public class GalleryObject
{
    public string Id { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public Point3D Position { get; set; } = new();
    public Point3D Rotation { get; set; } = new();
    public Point3D Scale { get; set; } = new() { X = 1.0, Y = 1.0, Z = 1.0 };
    public double Width { get; set; }
    public double Height { get; set; }
    public double Depth { get; set; }
}

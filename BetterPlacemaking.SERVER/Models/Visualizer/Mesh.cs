namespace BetterPlacemaking.Models.Visualizer;

public class Mesh
{
    public List<Point3D> Vertices { get; set; } = new();
    public List<Point3D> Normals { get; set; } = new();
    public List<int[]> Faces { get; set; } = new();
    public List<(double R, double G, double B)> Colors { get; set; } = new();

    public int VertexCount => Vertices.Count;
    public int FaceCount => Faces.Count;
    public bool HasNormals => Normals.Count > 0 && Normals.Count == Vertices.Count;
    public bool HasColors => Colors.Count > 0 && Colors.Count == Vertices.Count;
}

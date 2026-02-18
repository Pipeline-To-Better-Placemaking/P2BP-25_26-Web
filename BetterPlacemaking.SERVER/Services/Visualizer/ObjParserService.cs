using BetterPlacemaking.Models.Visualizer;

namespace BetterPlacemaking.Services.Visualizer;

public class ObjMeshData
{
    public List<Point3D> Vertices { get; set; } = new();
    public List<int[]> Faces { get; set; } = new();
    public List<Point3D> Normals { get; set; } = new();
}

public class ObjParserService
{
    public ObjMeshData ParseObjFile(Stream stream)
    {
        var meshData = new ObjMeshData();
        stream.Position = 0;
        using var reader = new StreamReader(stream);

        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            line = line.Trim();
            if (string.IsNullOrEmpty(line) || line.StartsWith("#"))
                continue;

            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0)
                continue;

            switch (parts[0])
            {
                case "v":
                    if (parts.Length >= 4)
                    {
                        meshData.Vertices.Add(new Point3D
                        {
                            X = double.Parse(parts[1]),
                            Y = double.Parse(parts[2]),
                            Z = double.Parse(parts[3])
                        });
                    }
                    break;
                case "f":
                    if (parts.Length >= 4)
                    {
                        var face = new List<int>();
                        for (int i = 1; i < parts.Length; i++)
                        {
                            var vertexIndex = parts[i].Split('/')[0];
                            face.Add(int.Parse(vertexIndex) - 1);
                        }
                        meshData.Faces.Add(face.ToArray());
                    }
                    break;
            }
        }

        return meshData;
    }

    public List<LidarPoint3D> ExtractPointCloudFromObj(Stream stream)
    {
        var meshData = ParseObjFile(stream);
        return meshData.Vertices.Select(v => new LidarPoint3D
        {
            X = v.X,
            Y = v.Y,
            Z = v.Z,
            Intensity = 0.8,
            Classification = 0
        }).ToList();
    }
}

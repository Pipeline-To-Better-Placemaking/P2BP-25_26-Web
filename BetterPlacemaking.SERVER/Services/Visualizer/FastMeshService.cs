using BetterPlacemaking.Models.Visualizer;
using MIConvexHull;

namespace BetterPlacemaking.Services.Visualizer;

/// <summary>
/// Fast mesh generation service using MIConvexHull for O(n log n) Delaunay triangulation.
/// Creates watertight/closed meshes from point cloud data.
/// </summary>
public class FastMeshService
{
    private readonly MeshGenerationService _meshService;

    public FastMeshService(MeshGenerationService meshService)
    {
        _meshService = meshService;
    }

    public Mesh CreateWatertightMesh(List<LidarPoint3D> points, int targetMeshPoints = 20000,
        double alphaValue = 30.0, int smoothingIterations = 5)
    {
        if (points == null || points.Count < 4)
            return new Mesh();

        Console.WriteLine($"FastMeshService: Starting mesh generation from {points.Count:N0} points");
        var sw = System.Diagnostics.Stopwatch.StartNew();

        var meshPoints = DownsampleForMesh(points, targetMeshPoints);
        Console.WriteLine($"  Downsampled to {meshPoints.Count:N0} points in {sw.ElapsedMilliseconds}ms");
        sw.Restart();

        var mesh = DelaunayTriangulate3D(meshPoints);
        Console.WriteLine($"  Delaunay triangulation: {mesh.FaceCount:N0} faces in {sw.ElapsedMilliseconds}ms");
        sw.Restart();

        if (mesh.FaceCount == 0)
        {
            Console.WriteLine("  Warning: No faces generated from triangulation");
            return mesh;
        }

        mesh = ApplyAlphaShape(mesh, alphaValue);
        Console.WriteLine($"  Alpha shape filtering: {mesh.FaceCount:N0} faces in {sw.ElapsedMilliseconds}ms");
        sw.Restart();

        mesh = CloseHoles(mesh);
        Console.WriteLine($"  Hole closing: {mesh.FaceCount:N0} faces in {sw.ElapsedMilliseconds}ms");
        sw.Restart();

        if (smoothingIterations > 0)
        {
            mesh = _meshService.SmoothMeshLaplacian(mesh, smoothingIterations);
            Console.WriteLine($"  Smoothing ({smoothingIterations} iterations) in {sw.ElapsedMilliseconds}ms");
        }

        mesh = ComputeNormals(mesh);
        mesh = AssignColorsToMesh(mesh, meshPoints);

        Console.WriteLine($"FastMeshService: Complete - {mesh.VertexCount:N0} vertices, {mesh.FaceCount:N0} faces");
        return mesh;
    }

    public List<LidarPoint3D> DownsampleForMesh(List<LidarPoint3D> points, int targetCount)
    {
        if (points.Count <= targetCount)
            return new List<LidarPoint3D>(points);

        double minX = double.MaxValue, maxX = double.MinValue;
        double minY = double.MaxValue, maxY = double.MinValue;
        double minZ = double.MaxValue, maxZ = double.MinValue;

        foreach (var p in points)
        {
            minX = Math.Min(minX, p.X); maxX = Math.Max(maxX, p.X);
            minY = Math.Min(minY, p.Y); maxY = Math.Max(maxY, p.Y);
            minZ = Math.Min(minZ, p.Z); maxZ = Math.Max(maxZ, p.Z);
        }

        double volume = (maxX - minX) * (maxY - minY) * (maxZ - minZ);
        double voxelVolume = volume / targetCount;
        double voxelSize = Math.Max(Math.Pow(voxelVolume, 1.0 / 3.0), 1.0);

        var voxelGrid = new Dictionary<(int, int, int), List<LidarPoint3D>>();

        foreach (var p in points)
        {
            int vx = (int)Math.Floor((p.X - minX) / voxelSize);
            int vy = (int)Math.Floor((p.Y - minY) / voxelSize);
            int vz = (int)Math.Floor((p.Z - minZ) / voxelSize);

            var key = (vx, vy, vz);
            if (!voxelGrid.ContainsKey(key))
                voxelGrid[key] = new List<LidarPoint3D>();
            voxelGrid[key].Add(p);
        }

        var result = new List<LidarPoint3D>();
        foreach (var voxel in voxelGrid.Values)
        {
            var representative = voxel[0];
            result.Add(new LidarPoint3D
            {
                X = voxel.Average(p => p.X),
                Y = voxel.Average(p => p.Y),
                Z = voxel.Average(p => p.Z),
                Intensity = representative.Intensity,
                Classification = representative.Classification,
                Color = representative.Color
            });
        }

        return result;
    }

    private Mesh DelaunayTriangulate3D(List<LidarPoint3D> points)
    {
        if (points.Count < 4)
            return new Mesh();

        var vertices = points.Select((p, i) => new Vertex3D(p.X, p.Y, p.Z, i)).ToList();

        try
        {
            var delaunay = Triangulation.CreateDelaunay<Vertex3D, Tetrahedron>(vertices);

            if (delaunay == null || delaunay.Cells == null)
            {
                Console.WriteLine("  Warning: Delaunay triangulation returned null");
                return new Mesh();
            }

            var mesh = ExtractSurfaceFromTetrahedra(delaunay.Cells, points);
            return mesh;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  Error in Delaunay triangulation: {ex.Message}");
            return Triangulate2_5D(points);
        }
    }

    private Mesh ExtractSurfaceFromTetrahedra(IEnumerable<Tetrahedron> tetrahedra, List<LidarPoint3D> points)
    {
        var mesh = new Mesh
        {
            Vertices = points.Select(p => new Point3D { X = p.X, Y = p.Y, Z = p.Z }).ToList(),
            Colors = points.Select(p => ParseColor(p.Color)).ToList()
        };

        var faceCount = new Dictionary<string, (int[] face, int count)>();

        foreach (var tet in tetrahedra)
        {
            var indices = tet.Vertices.Select(v => ((Vertex3D)v).Index).ToArray();

            var faces = new[]
            {
                new[] { indices[0], indices[1], indices[2] },
                new[] { indices[0], indices[1], indices[3] },
                new[] { indices[0], indices[2], indices[3] },
                new[] { indices[1], indices[2], indices[3] }
            };

            foreach (var face in faces)
            {
                var sorted = face.OrderBy(x => x).ToArray();
                var key = $"{sorted[0]},{sorted[1]},{sorted[2]}";

                if (faceCount.ContainsKey(key))
                {
                    var (f, c) = faceCount[key];
                    faceCount[key] = (f, c + 1);
                }
                else
                {
                    faceCount[key] = (face, 1);
                }
            }
        }

        foreach (var (key, (face, count)) in faceCount)
        {
            if (count == 1)
            {
                mesh.Faces.Add(face);
            }
        }

        return mesh;
    }

    private Mesh Triangulate2_5D(List<LidarPoint3D> points)
    {
        var mesh = new Mesh
        {
            Vertices = points.Select(p => new Point3D { X = p.X, Y = p.Y, Z = p.Z }).ToList(),
            Colors = points.Select(p => ParseColor(p.Color)).ToList()
        };

        var vertices2D = points.Select((p, i) => new Vertex2D(p.X, p.Y, i)).ToList();

        try
        {
            var delaunay = Triangulation.CreateDelaunay<Vertex2D, Triangle2D>(vertices2D);

            if (delaunay?.Cells != null)
            {
                foreach (var cell in delaunay.Cells)
                {
                    var indices = cell.Vertices.Select(v => ((Vertex2D)v).Index).ToArray();
                    if (indices.Length == 3)
                    {
                        mesh.Faces.Add(indices);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  Error in 2.5D triangulation: {ex.Message}");
        }

        return mesh;
    }

    public Mesh ApplyAlphaShape(Mesh mesh, double alphaMultiplier)
    {
        if (mesh.Faces.Count == 0)
            return mesh;

        double totalLength = 0;
        int edgeCount = 0;

        foreach (var face in mesh.Faces)
        {
            if (face.Length < 3) continue;
            var v0 = mesh.Vertices[face[0]];
            var v1 = mesh.Vertices[face[1]];
            var v2 = mesh.Vertices[face[2]];

            totalLength += Distance(v0, v1);
            totalLength += Distance(v1, v2);
            totalLength += Distance(v2, v0);
            edgeCount += 3;
        }

        double avgEdgeLength = edgeCount > 0 ? totalLength / edgeCount : 1.0;
        double maxEdgeLength = avgEdgeLength * alphaMultiplier;

        var filteredFaces = new List<int[]>();
        foreach (var face in mesh.Faces)
        {
            if (face.Length < 3) continue;
            var v0 = mesh.Vertices[face[0]];
            var v1 = mesh.Vertices[face[1]];
            var v2 = mesh.Vertices[face[2]];

            if (Distance(v0, v1) <= maxEdgeLength && Distance(v1, v2) <= maxEdgeLength && Distance(v2, v0) <= maxEdgeLength)
            {
                filteredFaces.Add(face);
            }
        }

        return new Mesh
        {
            Vertices = mesh.Vertices,
            Normals = mesh.Normals,
            Faces = filteredFaces,
            Colors = mesh.Colors
        };
    }

    public Mesh CloseHoles(Mesh mesh)
    {
        if (mesh.Faces.Count == 0)
            return mesh;

        var newFaces = new List<int[]>(mesh.Faces);

        var edgeCounts = new Dictionary<string, (int v1, int v2, int count)>();

        foreach (var face in mesh.Faces)
        {
            if (face.Length < 3) continue;

            var edges = new[]
            {
                (face[0], face[1]),
                (face[1], face[2]),
                (face[2], face[0])
            };

            foreach (var (v1, v2) in edges)
            {
                var key = v1 < v2 ? $"{v1},{v2}" : $"{v2},{v1}";
                if (edgeCounts.ContainsKey(key))
                {
                    var (a, b, c) = edgeCounts[key];
                    edgeCounts[key] = (a, b, c + 1);
                }
                else
                {
                    edgeCounts[key] = (v1, v2, 1);
                }
            }
        }

        var boundaryEdges = edgeCounts
            .Where(e => e.Value.count == 1)
            .Select(e => (e.Value.v1, e.Value.v2))
            .ToList();

        if (boundaryEdges.Count == 0)
            return mesh;

        var (filledFaces, newVertices, newColors) = FillBoundaryLoops(boundaryEdges, mesh.Vertices, mesh.Colors);
        newFaces.AddRange(filledFaces);

        var allVertices = new List<Point3D>(mesh.Vertices);
        allVertices.AddRange(newVertices);

        var allColors = new List<(double R, double G, double B)>(mesh.Colors);
        allColors.AddRange(newColors);

        return new Mesh
        {
            Vertices = allVertices,
            Normals = mesh.Normals,
            Faces = newFaces,
            Colors = allColors
        };
    }

    private (List<int[]> filledFaces, List<Point3D> newVertices, List<(double R, double G, double B)> newColors)
        FillBoundaryLoops(List<(int v1, int v2)> boundaryEdges, List<Point3D> vertices, List<(double R, double G, double B)> colors)
    {
        var filledFaces = new List<int[]>();
        var newVertices = new List<Point3D>();
        var newColors = new List<(double R, double G, double B)>();
        var usedEdges = new HashSet<string>();

        var adjacency = new Dictionary<int, List<int>>();
        foreach (var (v1, v2) in boundaryEdges)
        {
            if (!adjacency.ContainsKey(v1)) adjacency[v1] = new List<int>();
            if (!adjacency.ContainsKey(v2)) adjacency[v2] = new List<int>();
            adjacency[v1].Add(v2);
            adjacency[v2].Add(v1);
        }

        int maxLoops = 100;
        int loopCount = 0;
        int baseVertexCount = vertices.Count;

        foreach (var startVertex in adjacency.Keys)
        {
            if (loopCount >= maxLoops) break;

            var loop = FindLoop(startVertex, adjacency, usedEdges);
            if (loop != null && loop.Count >= 3)
            {
                var centroid = new Point3D
                {
                    X = loop.Average(i => vertices[i].X),
                    Y = loop.Average(i => vertices[i].Y),
                    Z = loop.Average(i => vertices[i].Z)
                };

                double r = 0, g = 0, b = 0;
                if (colors.Count > 0)
                {
                    foreach (var idx in loop)
                    {
                        if (idx < colors.Count)
                        {
                            r += colors[idx].R;
                            g += colors[idx].G;
                            b += colors[idx].B;
                        }
                    }
                    r /= loop.Count;
                    g /= loop.Count;
                    b /= loop.Count;
                }
                else
                {
                    r = g = b = 0.5;
                }

                int centroidIdx = baseVertexCount + newVertices.Count;
                newVertices.Add(centroid);
                newColors.Add((r, g, b));

                for (int i = 0; i < loop.Count; i++)
                {
                    int lv1 = loop[i];
                    int lv2 = loop[(i + 1) % loop.Count];
                    filledFaces.Add(new[] { lv1, lv2, centroidIdx });
                }

                loopCount++;
            }
        }

        return (filledFaces, newVertices, newColors);
    }

    private List<int>? FindLoop(int startVertex, Dictionary<int, List<int>> adjacency, HashSet<string> usedEdges)
    {
        var loop = new List<int> { startVertex };
        var visited = new HashSet<int> { startVertex };
        var current = startVertex;
        int maxIterations = 1000;
        int iterations = 0;

        while (iterations < maxIterations)
        {
            iterations++;

            if (!adjacency.ContainsKey(current))
                break;

            var neighbors = adjacency[current];
            int next = -1;

            foreach (var neighbor in neighbors)
            {
                var edgeKey = current < neighbor ? $"{current},{neighbor}" : $"{neighbor},{current}";
                if (!usedEdges.Contains(edgeKey))
                {
                    if (neighbor == startVertex && loop.Count >= 3)
                    {
                        usedEdges.Add(edgeKey);
                        return loop;
                    }
                    else if (!visited.Contains(neighbor))
                    {
                        next = neighbor;
                        usedEdges.Add(edgeKey);
                        break;
                    }
                }
            }

            if (next == -1)
                break;

            loop.Add(next);
            visited.Add(next);
            current = next;
        }

        return null;
    }

    private Mesh ComputeNormals(Mesh mesh)
    {
        var normals = new Point3D[mesh.Vertices.Count];
        for (int i = 0; i < normals.Length; i++)
            normals[i] = new Point3D();

        foreach (var face in mesh.Faces)
        {
            if (face.Length < 3) continue;

            var v0 = mesh.Vertices[face[0]];
            var v1 = mesh.Vertices[face[1]];
            var v2 = mesh.Vertices[face[2]];

            var u = new Point3D { X = v1.X - v0.X, Y = v1.Y - v0.Y, Z = v1.Z - v0.Z };
            var v = new Point3D { X = v2.X - v0.X, Y = v2.Y - v0.Y, Z = v2.Z - v0.Z };

            var normal = new Point3D
            {
                X = u.Y * v.Z - u.Z * v.Y,
                Y = u.Z * v.X - u.X * v.Z,
                Z = u.X * v.Y - u.Y * v.X
            };

            foreach (var idx in face)
            {
                normals[idx].X += normal.X;
                normals[idx].Y += normal.Y;
                normals[idx].Z += normal.Z;
            }
        }

        for (int i = 0; i < normals.Length; i++)
        {
            var n = normals[i];
            var length = Math.Sqrt(n.X * n.X + n.Y * n.Y + n.Z * n.Z);
            if (length > 1e-9)
            {
                normals[i] = new Point3D { X = n.X / length, Y = n.Y / length, Z = n.Z / length };
            }
            else
            {
                normals[i] = new Point3D { X = 0, Y = 1, Z = 0 };
            }
        }

        return new Mesh
        {
            Vertices = mesh.Vertices,
            Normals = normals.ToList(),
            Faces = mesh.Faces,
            Colors = mesh.Colors
        };
    }

    private Mesh AssignColorsToMesh(Mesh mesh, List<LidarPoint3D> downsampledPoints)
    {
        if (mesh.Vertices.Count == 0)
            return mesh;

        var colors = new List<(double R, double G, double B)>();

        for (int i = 0; i < mesh.Vertices.Count; i++)
        {
            var vertex = mesh.Vertices[i];

            if (i < mesh.Colors.Count)
            {
                colors.Add(mesh.Colors[i]);
                continue;
            }

            var nearest = downsampledPoints
                .OrderBy(p => Distance(vertex, new Point3D { X = p.X, Y = p.Y, Z = p.Z }))
                .Take(5)
                .ToList();

            if (nearest.Count > 0)
            {
                double totalWeight = 0;
                double r = 0, g = 0, b = 0;

                foreach (var p in nearest)
                {
                    double dist = Distance(vertex, new Point3D { X = p.X, Y = p.Y, Z = p.Z });
                    double weight = dist > 0 ? 1.0 / (dist * dist + 0.1) : 10.0;
                    var color = ParseColor(p.Color);
                    r += color.R * weight;
                    g += color.G * weight;
                    b += color.B * weight;
                    totalWeight += weight;
                }

                colors.Add(totalWeight > 0 ? (r / totalWeight, g / totalWeight, b / totalWeight) : (0.5, 0.5, 0.5));
            }
            else
            {
                colors.Add((0.5, 0.5, 0.5));
            }
        }

        return new Mesh
        {
            Vertices = mesh.Vertices,
            Normals = mesh.Normals,
            Faces = mesh.Faces,
            Colors = colors
        };
    }

    private (double R, double G, double B) ParseColor(string? colorHex)
    {
        if (string.IsNullOrEmpty(colorHex) || !colorHex.StartsWith("#"))
            return (0.5, 0.5, 0.5);

        try
        {
            var hex = colorHex.Substring(1);
            if (hex.Length == 6)
            {
                int r = Convert.ToInt32(hex.Substring(0, 2), 16);
                int g = Convert.ToInt32(hex.Substring(2, 2), 16);
                int b = Convert.ToInt32(hex.Substring(4, 2), 16);
                return (r / 255.0, g / 255.0, b / 255.0);
            }
        }
        catch { }

        return (0.5, 0.5, 0.5);
    }

    private static double Distance(Point3D a, Point3D b)
    {
        double dx = a.X - b.X;
        double dy = a.Y - b.Y;
        double dz = a.Z - b.Z;
        return Math.Sqrt(dx * dx + dy * dy + dz * dz);
    }
}

// MIConvexHull vertex/cell implementations

internal class Vertex3D : IVertex
{
    public double[] Position { get; }
    public int Index { get; }

    public Vertex3D(double x, double y, double z, int index)
    {
        Position = new[] { x, y, z };
        Index = index;
    }
}

internal class Vertex2D : IVertex
{
    public double[] Position { get; }
    public int Index { get; }

    public Vertex2D(double x, double y, int index)
    {
        Position = new[] { x, y };
        Index = index;
    }
}

internal class Tetrahedron : TriangulationCell<Vertex3D, Tetrahedron>
{
}

internal class Triangle2D : TriangulationCell<Vertex2D, Triangle2D>
{
}

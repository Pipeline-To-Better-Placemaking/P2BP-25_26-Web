using BetterPlacemaking.Models.Visualizer;
using System.Text;

namespace BetterPlacemaking.Services.Visualizer;

/// <summary>
/// Simple spatial grid for k-nearest neighbor queries.
/// </summary>
internal class SpatialGrid
{
    private readonly Dictionary<(int, int, int), List<int>> _grid = new();
    private readonly double _cellSize;
    private readonly double _minX, _minY, _minZ;
    private readonly List<Point3D> _points;

    public SpatialGrid(List<Point3D> points, double cellSize)
    {
        _points = points;
        _cellSize = cellSize;

        if (points.Count == 0)
        {
            _minX = _minY = _minZ = 0;
            return;
        }

        _minX = points.Min(p => p.X);
        _minY = points.Min(p => p.Y);
        _minZ = points.Min(p => p.Z);

        for (int i = 0; i < points.Count; i++)
        {
            var cell = GetCell(points[i]);
            if (!_grid.ContainsKey(cell))
                _grid[cell] = new List<int>();
            _grid[cell].Add(i);
        }
    }

    private (int, int, int) GetCell(Point3D p)
    {
        int x = (int)Math.Floor((p.X - _minX) / _cellSize);
        int y = (int)Math.Floor((p.Y - _minY) / _cellSize);
        int z = (int)Math.Floor((p.Z - _minZ) / _cellSize);
        return (x, y, z);
    }

    public List<int> FindKNearestNeighbors(int pointIndex, int k)
    {
        var point = _points[pointIndex];
        var neighbors = new List<(int index, double distance)>();

        var centerCell = GetCell(point);
        int searchRadius = 0;
        int maxRadius = 10;

        while (neighbors.Count < k && searchRadius <= maxRadius)
        {
            for (int dx = -searchRadius; dx <= searchRadius; dx++)
            {
                for (int dy = -searchRadius; dy <= searchRadius; dy++)
                {
                    for (int dz = -searchRadius; dz <= searchRadius; dz++)
                    {
                        if (Math.Abs(dx) != searchRadius && Math.Abs(dy) != searchRadius && Math.Abs(dz) != searchRadius)
                            continue;

                        var cell = (centerCell.Item1 + dx, centerCell.Item2 + dy, centerCell.Item3 + dz);
                        if (_grid.TryGetValue(cell, out var cellPoints))
                        {
                            foreach (var idx in cellPoints)
                            {
                                if (idx == pointIndex) continue;
                                var dist = DistanceSquared(point, _points[idx]);
                                neighbors.Add((idx, dist));
                            }
                        }
                    }
                }
            }
            searchRadius++;
        }

        if (neighbors.Count < k)
        {
            for (int i = 0; i < _points.Count; i++)
            {
                if (i == pointIndex) continue;
                var dist = DistanceSquared(point, _points[i]);
                neighbors.Add((i, dist));
            }
        }

        return neighbors
            .OrderBy(n => n.distance)
            .Take(k)
            .Select(n => n.index)
            .ToList();
    }

    private static double DistanceSquared(Point3D a, Point3D b)
    {
        double dx = a.X - b.X;
        double dy = a.Y - b.Y;
        double dz = a.Z - b.Z;
        return dx * dx + dy * dy + dz * dz;
    }
}

public class MeshGenerationService
{
    private const double Epsilon = 1e-9;
    private const int DefaultKNeighbors = 15;
    private const int DefaultSmoothingIterations = 5;
    private const double DefaultSmoothingLambda = 0.5;
    private const double MaxEdgeLengthRatio = 5.0;
    private const double MaxZVariationRatio = 1.0;

    public Mesh CreateMeshFromPointCloud(List<LidarPoint3D> points)
    {
        if (points == null || points.Count == 0)
            return new Mesh();

        var cleanedPoints = PreprocessPoints(points);

        if (cleanedPoints.Count < 3)
            return new Mesh { Vertices = cleanedPoints.Select(p => new Point3D { X = p.X, Y = p.Y, Z = p.Z }).ToList() };

        var normals = EstimateNormals(cleanedPoints, k: DefaultKNeighbors);
        var faces = TriangulateDelaunay2_5D(cleanedPoints);

        var mesh = new Mesh
        {
            Vertices = cleanedPoints.Select(p => new Point3D { X = p.X, Y = p.Y, Z = p.Z }).ToList(),
            Normals = normals,
            Faces = faces
        };

        return mesh;
    }

    public Mesh SmoothMeshLaplacian(Mesh mesh, int iterations = DefaultSmoothingIterations, double lambda = DefaultSmoothingLambda)
    {
        if (mesh == null || mesh.Vertices.Count == 0 || mesh.Faces.Count == 0)
            return mesh!;

        var adjacency = BuildVertexAdjacency(mesh);
        var boundaryVertices = IdentifyBoundaryVertices(mesh);
        var smoothedVertices = mesh.Vertices.Select(v => new Point3D { X = v.X, Y = v.Y, Z = v.Z }).ToList();

        for (int iter = 0; iter < iterations; iter++)
        {
            var newVertices = new List<Point3D>(smoothedVertices);

            for (int i = 0; i < smoothedVertices.Count; i++)
            {
                if (boundaryVertices.Contains(i))
                {
                    newVertices[i] = smoothedVertices[i];
                    continue;
                }

                if (!adjacency.TryGetValue(i, out var neighbors) || neighbors.Count == 0)
                {
                    newVertices[i] = smoothedVertices[i];
                    continue;
                }

                double avgX = 0, avgY = 0, avgZ = 0;
                foreach (var neighborIdx in neighbors)
                {
                    var neighbor = smoothedVertices[neighborIdx];
                    avgX += neighbor.X;
                    avgY += neighbor.Y;
                    avgZ += neighbor.Z;
                }
                avgX /= neighbors.Count;
                avgY /= neighbors.Count;
                avgZ /= neighbors.Count;

                var current = smoothedVertices[i];
                newVertices[i] = new Point3D
                {
                    X = current.X + lambda * (avgX - current.X),
                    Y = current.Y + lambda * (avgY - current.Y),
                    Z = current.Z + lambda * (avgZ - current.Z)
                };
            }

            smoothedVertices = newVertices;
        }

        return new Mesh
        {
            Vertices = smoothedVertices,
            Normals = mesh.Normals,
            Faces = mesh.Faces
        };
    }

    public Mesh OptimizeMesh(Mesh mesh)
    {
        if (mesh == null || mesh.Vertices.Count == 0)
            return mesh!;

        var optimized = new Mesh
        {
            Vertices = new List<Point3D>(mesh.Vertices),
            Normals = mesh.Normals.Count > 0 ? new List<Point3D>(mesh.Normals) : new List<Point3D>(),
            Faces = new List<int[]>()
        };

        double avgEdgeLength = 0;
        int edgeCount = 0;
        foreach (var face in mesh.Faces)
        {
            if (face.Length >= 3)
            {
                var v0 = mesh.Vertices[face[0]];
                var v1 = mesh.Vertices[face[1]];
                var v2 = mesh.Vertices[face[2]];
                avgEdgeLength += Distance(v0, v1);
                avgEdgeLength += Distance(v1, v2);
                avgEdgeLength += Distance(v2, v0);
                edgeCount += 3;
            }
        }
        if (edgeCount > 0)
            avgEdgeLength /= edgeCount;

        double maxEdgeLength = avgEdgeLength * MaxEdgeLengthRatio;
        double minArea = avgEdgeLength * avgEdgeLength * 0.01;

        double minZ = mesh.Vertices.Min(v => v.Z);
        double maxZ = mesh.Vertices.Max(v => v.Z);
        double zRange = Math.Max(maxZ - minZ, 1.0);
        double maxZVariation = zRange * MaxZVariationRatio;

        var vertexToNewIndex = new Dictionary<int, int>();
        var mergedVertices = new List<Point3D>();
        double mergeThreshold = avgEdgeLength * 0.1;

        for (int i = 0; i < optimized.Vertices.Count; i++)
        {
            bool merged = false;
            for (int j = 0; j < mergedVertices.Count; j++)
            {
                if (Distance(optimized.Vertices[i], mergedVertices[j]) < mergeThreshold)
                {
                    vertexToNewIndex[i] = j;
                    merged = true;
                    break;
                }
            }
            if (!merged)
            {
                vertexToNewIndex[i] = mergedVertices.Count;
                mergedVertices.Add(optimized.Vertices[i]);
            }
        }

        optimized.Vertices = mergedVertices;

        foreach (var face in mesh.Faces)
        {
            if (face.Length < 3) continue;

            var newFace = new int[face.Length];
            bool valid = true;
            for (int i = 0; i < face.Length; i++)
            {
                if (!vertexToNewIndex.TryGetValue(face[i], out var newIdx))
                {
                    valid = false;
                    break;
                }
                newFace[i] = newIdx;
            }

            if (!valid) continue;

            if (newFace[0] == newFace[1] || newFace[1] == newFace[2] || newFace[0] == newFace[2])
                continue;

            var v0 = optimized.Vertices[newFace[0]];
            var v1 = optimized.Vertices[newFace[1]];
            var v2 = optimized.Vertices[newFace[2]];

            double area = CalculateTriangleArea(v0, v1, v2);
            if (area < minArea)
                continue;

            if (Distance(v0, v1) > maxEdgeLength || Distance(v1, v2) > maxEdgeLength || Distance(v2, v0) > maxEdgeLength)
                continue;

            double faceMinZ = Math.Min(Math.Min(v0.Z, v1.Z), v2.Z);
            double faceMaxZ = Math.Max(Math.Max(v0.Z, v1.Z), v2.Z);
            if (faceMaxZ - faceMinZ > maxZVariation)
                continue;

            optimized.Faces.Add(newFace);
        }

        if (optimized.Normals.Count > 0 && optimized.Normals.Count == mesh.Normals.Count)
        {
            var mergedNormals = new List<Point3D>();
            for (int i = 0; i < mergedVertices.Count; i++)
            {
                var originalIndices = vertexToNewIndex.Where(kvp => kvp.Value == i).Select(kvp => kvp.Key).ToList();
                if (originalIndices.Count > 0)
                {
                    double nx = 0, ny = 0, nz = 0;
                    foreach (var origIdx in originalIndices)
                    {
                        if (origIdx < mesh.Normals.Count)
                        {
                            nx += mesh.Normals[origIdx].X;
                            ny += mesh.Normals[origIdx].Y;
                            nz += mesh.Normals[origIdx].Z;
                        }
                    }
                    double len = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                    if (len > Epsilon)
                    {
                        mergedNormals.Add(new Point3D { X = nx / len, Y = ny / len, Z = nz / len });
                    }
                    else
                    {
                        mergedNormals.Add(new Point3D { X = 0, Y = 0, Z = 1 });
                    }
                }
                else
                {
                    mergedNormals.Add(new Point3D { X = 0, Y = 0, Z = 1 });
                }
            }
            optimized.Normals = mergedNormals;
        }

        return optimized;
    }

    public string ExportMeshToObj(Mesh mesh)
    {
        var sb = new StringBuilder();

        if (mesh.HasColors)
        {
            for (int i = 0; i < mesh.Vertices.Count; i++)
            {
                var vertex = mesh.Vertices[i];
                var color = mesh.Colors[i];
                sb.AppendLine($"v {vertex.X} {vertex.Z} {vertex.Y} {color.R} {color.G} {color.B}");
            }
        }
        else
        {
            foreach (var vertex in mesh.Vertices)
            {
                sb.AppendLine($"v {vertex.X} {vertex.Z} {vertex.Y}");
            }
        }

        if (mesh.HasNormals)
        {
            foreach (var normal in mesh.Normals)
            {
                sb.AppendLine($"vn {normal.X} {normal.Z} {normal.Y}");
            }
        }

        foreach (var face in mesh.Faces)
        {
            if (mesh.HasNormals)
            {
                var faceStr = string.Join(" ", face.Select(i => $"{i + 1}//{i + 1}"));
                sb.AppendLine($"f {faceStr}");
            }
            else
            {
                sb.AppendLine($"f {string.Join(" ", face.Select(i => i + 1))}");
            }
        }
        return sb.ToString();
    }

    // Helper methods

    private List<LidarPoint3D> PreprocessPoints(List<LidarPoint3D> points)
    {
        var seen = new HashSet<(double, double, double)>();
        var cleaned = new List<LidarPoint3D>();
        const double tolerance = 0.1;

        foreach (var point in points)
        {
            var key = (
                Math.Round(point.X / tolerance) * tolerance,
                Math.Round(point.Y / tolerance) * tolerance,
                Math.Round(point.Z / tolerance) * tolerance
            );

            if (!seen.Contains(key))
            {
                seen.Add(key);
                cleaned.Add(point);
            }
        }

        return cleaned;
    }

    private List<Point3D> EstimateNormals(List<LidarPoint3D> points, int k = DefaultKNeighbors)
    {
        if (points.Count == 0)
            return new List<Point3D>();

        var normals = new List<Point3D>(points.Count);

        double minX = points.Min(p => p.X);
        double maxX = points.Max(p => p.X);
        double minY = points.Min(p => p.Y);
        double maxY = points.Max(p => p.Y);
        double minZVal = points.Min(p => p.Z);
        double maxZVal = points.Max(p => p.Z);

        double cellSize = Math.Max(Math.Max(maxX - minX, maxY - minY), maxZVal - minZVal) / 50.0;
        if (cellSize < 1.0) cellSize = 1.0;

        var pointList = points.Select(p => new Point3D { X = p.X, Y = p.Y, Z = p.Z }).ToList();
        var spatialGrid = new SpatialGrid(pointList, cellSize);

        for (int i = 0; i < points.Count; i++)
        {
            var neighbors = spatialGrid.FindKNearestNeighbors(i, k);
            if (neighbors.Count < 3)
            {
                normals.Add(new Point3D { X = 0, Y = 0, Z = 1 });
                continue;
            }

            var p0 = pointList[neighbors[0]];
            var p1 = pointList[neighbors[1]];
            var p2 = pointList[neighbors[2]];

            double v1x = p1.X - p0.X;
            double v1y = p1.Y - p0.Y;
            double v1z = p1.Z - p0.Z;

            double v2x = p2.X - p0.X;
            double v2y = p2.Y - p0.Y;
            double v2z = p2.Z - p0.Z;

            double nx = v1y * v2z - v1z * v2y;
            double ny = v1z * v2x - v1x * v2z;
            double nz = v1x * v2y - v1y * v2x;

            double len = Math.Sqrt(nx * nx + ny * ny + nz * nz);
            if (len > Epsilon)
            {
                normals.Add(new Point3D { X = nx / len, Y = ny / len, Z = nz / len });
            }
            else
            {
                normals.Add(new Point3D { X = 0, Y = 0, Z = 1 });
            }
        }

        if (normals.Count > 0)
        {
            var firstNormal = normals[0];
            for (int i = 1; i < normals.Count; i++)
            {
                var current = normals[i];
                double dot = firstNormal.X * current.X + firstNormal.Y * current.Y + firstNormal.Z * current.Z;
                if (dot < 0)
                {
                    normals[i] = new Point3D { X = -current.X, Y = -current.Y, Z = -current.Z };
                }
            }
        }

        return normals;
    }

    private List<int[]> TriangulateDelaunay2_5D(List<LidarPoint3D> points)
    {
        if (points.Count < 3)
            return new List<int[]>();

        var points2D = points.Select((p, i) => new Point2D { X = p.X, Y = p.Y, Index = i }).ToList();

        double minX = points2D.Min(p => p.X);
        double maxX = points2D.Max(p => p.X);
        double minY = points2D.Min(p => p.Y);
        double maxY = points2D.Max(p => p.Y);

        double dx = maxX - minX;
        double dy = maxY - minY;
        double margin = Math.Max(dx, dy) * 0.5;
        var superTriangle = new[]
        {
            new Point2D { X = minX - margin, Y = minY - margin, Index = -1 },
            new Point2D { X = maxX + margin * 2, Y = minY - margin, Index = -2 },
            new Point2D { X = (minX + maxX) / 2, Y = maxY + margin * 2, Index = -3 }
        };

        var triangles = new List<(int, int, int)>();
        triangles.Add((superTriangle[0].Index, superTriangle[1].Index, superTriangle[2].Index));

        foreach (var point in points2D)
        {
            var badTriangles = new List<(int, int, int)>();
            foreach (var triangle in triangles)
            {
                var triPoints = GetTrianglePoints(triangle, points2D, superTriangle);
                if (IsPointInCircumcircle(point, triPoints.Item1, triPoints.Item2, triPoints.Item3))
                {
                    badTriangles.Add(triangle);
                }
            }

            var edges = new List<(int, int)>();
            foreach (var triangle in badTriangles)
            {
                edges.Add((triangle.Item1, triangle.Item2));
                edges.Add((triangle.Item2, triangle.Item3));
                edges.Add((triangle.Item3, triangle.Item1));
            }

            var edgeCounts = new Dictionary<(int, int), int>();
            foreach (var edge in edges)
            {
                var key = edge.Item1 < edge.Item2 ? edge : (edge.Item2, edge.Item1);
                edgeCounts[key] = edgeCounts.GetValueOrDefault(key, 0) + 1;
            }

            var boundaryEdges = edgeCounts.Where(e => e.Value == 1).Select(e => e.Key).ToList();

            foreach (var triangle in badTriangles)
            {
                triangles.Remove(triangle);
            }

            foreach (var edge in boundaryEdges)
            {
                triangles.Add((edge.Item1, edge.Item2, point.Index));
            }
        }

        triangles.RemoveAll(t => t.Item1 < 0 || t.Item2 < 0 || t.Item3 < 0);

        var faces = new List<int[]>();

        double totalEdgeLength = 0;
        int validTriangleCount = 0;
        foreach (var triangle in triangles)
        {
            if (triangle.Item1 >= 0 && triangle.Item2 >= 0 && triangle.Item3 >= 0)
            {
                var v0 = points[triangle.Item1];
                var v1 = points[triangle.Item2];
                var v2 = points[triangle.Item3];

                totalEdgeLength += Distance(new Point3D { X = v0.X, Y = v0.Y, Z = v0.Z },
                                           new Point3D { X = v1.X, Y = v1.Y, Z = v1.Z });
                totalEdgeLength += Distance(new Point3D { X = v1.X, Y = v1.Y, Z = v1.Z },
                                           new Point3D { X = v2.X, Y = v2.Y, Z = v2.Z });
                totalEdgeLength += Distance(new Point3D { X = v2.X, Y = v2.Y, Z = v2.Z },
                                           new Point3D { X = v0.X, Y = v0.Y, Z = v0.Z });
                validTriangleCount++;
            }
        }
        double avgEdgeLengthVal = validTriangleCount > 0 ? totalEdgeLength / (validTriangleCount * 3) : 100.0;
        double maxEdgeLengthVal = avgEdgeLengthVal * MaxEdgeLengthRatio;

        foreach (var triangle in triangles)
        {
            if (triangle.Item1 < 0 || triangle.Item2 < 0 || triangle.Item3 < 0)
                continue;

            var v0 = points[triangle.Item1];
            var v1 = points[triangle.Item2];
            var v2 = points[triangle.Item3];

            var pt0 = new Point3D { X = v0.X, Y = v0.Y, Z = v0.Z };
            var pt1 = new Point3D { X = v1.X, Y = v1.Y, Z = v1.Z };
            var pt2 = new Point3D { X = v2.X, Y = v2.Y, Z = v2.Z };

            double edge1 = Distance(pt0, pt1);
            double edge2 = Distance(pt1, pt2);
            double edge3 = Distance(pt2, pt0);

            if (edge1 > maxEdgeLengthVal || edge2 > maxEdgeLengthVal || edge3 > maxEdgeLengthVal)
                continue;

            faces.Add(new[] { triangle.Item1, triangle.Item2, triangle.Item3 });
        }

        return faces;
    }

    private bool IsPointInCircumcircle(Point2D point, Point2D p1, Point2D p2, Point2D p3)
    {
        double ax = p1.X - point.X, ay = p1.Y - point.Y;
        double bx = p2.X - point.X, by = p2.Y - point.Y;
        double cx = p3.X - point.X, cy = p3.Y - point.Y;

        double det = ax * (by * (cx * cx + cy * cy) - cy * (bx * bx + by * by)) -
                     ay * (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) +
                     (ax * ax + ay * ay) * (bx * cy - by * cx);

        return det > 0;
    }

    private (Point2D, Point2D, Point2D) GetTrianglePoints((int, int, int) triangle, List<Point2D> points2D, Point2D[] superTriangle)
    {
        var getPoint = (int idx) =>
        {
            if (idx < 0)
                return superTriangle[-idx - 1];
            return points2D[idx];
        };

        return (getPoint(triangle.Item1), getPoint(triangle.Item2), getPoint(triangle.Item3));
    }

    private class Point2D
    {
        public double X { get; set; }
        public double Y { get; set; }
        public int Index { get; set; }
    }

    private Dictionary<int, HashSet<int>> BuildVertexAdjacency(Mesh mesh)
    {
        var adjacency = new Dictionary<int, HashSet<int>>();

        foreach (var face in mesh.Faces)
        {
            if (face.Length < 2) continue;

            for (int i = 0; i < face.Length; i++)
            {
                int v0 = face[i];
                int v1 = face[(i + 1) % face.Length];

                if (!adjacency.ContainsKey(v0))
                    adjacency[v0] = new HashSet<int>();
                if (!adjacency.ContainsKey(v1))
                    adjacency[v1] = new HashSet<int>();

                adjacency[v0].Add(v1);
                adjacency[v1].Add(v0);
            }
        }

        return adjacency;
    }

    private HashSet<int> IdentifyBoundaryVertices(Mesh mesh)
    {
        var boundaryVertices = new HashSet<int>();
        var edgeCounts = new Dictionary<(int, int), int>();

        foreach (var face in mesh.Faces)
        {
            if (face.Length < 2) continue;

            for (int i = 0; i < face.Length; i++)
            {
                int v0 = face[i];
                int v1 = face[(i + 1) % face.Length];
                var edge = v0 < v1 ? (v0, v1) : (v1, v0);
                edgeCounts[edge] = edgeCounts.GetValueOrDefault(edge, 0) + 1;
            }
        }

        foreach (var edge in edgeCounts.Where(e => e.Value == 1))
        {
            boundaryVertices.Add(edge.Key.Item1);
            boundaryVertices.Add(edge.Key.Item2);
        }

        return boundaryVertices;
    }

    private double CalculateTriangleArea(Point3D a, Point3D b, Point3D c)
    {
        double abx = b.X - a.X, aby = b.Y - a.Y, abz = b.Z - a.Z;
        double acx = c.X - a.X, acy = c.Y - a.Y, acz = c.Z - a.Z;

        double nx = aby * acz - abz * acy;
        double ny = abz * acx - abx * acz;
        double nz = abx * acy - aby * acx;

        return 0.5 * Math.Sqrt(nx * nx + ny * ny + nz * nz);
    }

    private static double Distance(Point3D a, Point3D b)
    {
        double dx = a.X - b.X;
        double dy = a.Y - b.Y;
        double dz = a.Z - b.Z;
        return Math.Sqrt(dx * dx + dy * dy + dz * dz);
    }
}

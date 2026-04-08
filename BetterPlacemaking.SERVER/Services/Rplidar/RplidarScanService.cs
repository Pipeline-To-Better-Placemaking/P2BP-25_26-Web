using System.Numerics;
using BetterPlacemaking.Models.Visualizer;

namespace BetterPlacemaking.Services.Rplidar;

/// <summary>
/// Processes raw RPLidar .xyz scan files into classified point clouds
/// with obstacle detection. Analogous to StanfordDatasetParserService
/// but for RPLidar ceiling-mount scans.
/// </summary>
public class RplidarScanService
{
    private readonly ILogger<RplidarScanService> _logger;
    private readonly IConfiguration _configuration;

    public RplidarScanService(ILogger<RplidarScanService> logger, IConfiguration configuration)
    {
        _logger = logger;
        _configuration = configuration;
    }

    // ─── Configuration (from appsettings.json) ───

    private double FloorThreshold =>
        _configuration.GetValue("RplidarScan:FloorThreshold", -4.3);

    private double CeilingThreshold =>
        _configuration.GetValue("RplidarScan:CeilingThreshold", -1.0);

    private double ClusterGridSize =>
        _configuration.GetValue("RplidarScan:ClusterGridSize", 0.4);

    private int MinClusterPoints =>
        _configuration.GetValue("RplidarScan:MinClusterPoints", 10);

    private float WallMargin =>
        (float)_configuration.GetValue("RplidarScan:WallMargin", 0.8);

    private float ScannerExclusionRadius =>
        (float)_configuration.GetValue("RplidarScan:ScannerExclusionRadius", 2.0);

    private float GroundContactMargin =>
        (float)_configuration.GetValue("RplidarScan:GroundContactMargin", 0.9);

    private float MaxObstacleDimension =>
        (float)_configuration.GetValue("RplidarScan:MaxObstacleDimension", 5.0);

    // ─── Public API ───

    /// <summary>
    /// Parse a .xyz file and return fully classified scan data.
    /// </summary>
    public RplidarScanResult ParseXyzFile(string filePath)
    {
        _logger.LogInformation("Parsing RPLidar scan: {Path}", filePath);

        var lines = File.ReadAllLines(filePath);
        var allPoints = new List<Vector3>(lines.Length);

        foreach (var line in lines)
        {
            var parts = line.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 3 &&
                float.TryParse(parts[0], out var x) &&
                float.TryParse(parts[1], out var y) &&
                float.TryParse(parts[2], out var z))
            {
                allPoints.Add(new Vector3(x, y, z));
            }
        }

        _logger.LogInformation("Parsed {Count} points from {Path}", allPoints.Count, filePath);
        return ClassifyAndCluster(allPoints);
    }

    /// <summary>
    /// Parse from raw text (for API upload scenarios).
    /// </summary>
    public RplidarScanResult ParseXyzText(string xyzText)
    {
        var lines = xyzText.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        var allPoints = new List<Vector3>(lines.Length);

        foreach (var line in lines)
        {
            var parts = line.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 3 &&
                float.TryParse(parts[0], out var x) &&
                float.TryParse(parts[1], out var y) &&
                float.TryParse(parts[2], out var z))
            {
                allPoints.Add(new Vector3(x, y, z));
            }
        }

        return ClassifyAndCluster(allPoints);
    }

    /// <summary>
    /// Re-classify an already-parsed scan with new thresholds.
    /// Useful for the frontend threshold sliders.
    /// </summary>
    public RplidarScanResult Reclassify(
        List<Vector3> allPoints,
        double floorThreshold,
        double ceilingThreshold)
    {
        return ClassifyAndCluster(allPoints, floorThreshold, ceilingThreshold);
    }

    /// <summary>
    /// Run object detection on the current in-memory point cloud (e.g. from 3D view upload).
    /// Converts cm to meters so thresholds and clustering match file-based .xyz behavior.
    /// </summary>
    public RplidarScanResult ParseFromPointCloud(IReadOnlyList<LidarPoint3D> points)
    {
        if (points == null || points.Count == 0)
            throw new InvalidOperationException("No points provided.");
        var inMeters = points.Select(p => new Vector3(
            (float)(p.X / 100.0),
            (float)(p.Y / 100.0),
            (float)(p.Z / 100.0))).ToList();
        _logger.LogInformation("Running object detection on current point cloud: {Count} points (cm → m)", points.Count);
        return ClassifyAndCluster(inMeters);
    }

    // ─── Core Processing ───

    private RplidarScanResult ClassifyAndCluster(
        List<Vector3> allPoints,
        double? floorThreshOverride = null,
        double? ceilThreshOverride = null)
    {
        var floorThresh = floorThreshOverride ?? FloorThreshold;
        var ceilThresh = ceilThreshOverride ?? CeilingThreshold;

        // Classify by Z-height
        // Note: do NOT add a noise margin here — it clips real obstacle bases.
        // The ground-contact check in clustering handles floor noise rejection.
        var obstacleMinZ = floorThresh;

        var floor = new List<Vector2>();
        var obstacles = new List<Vector3>();
        var ceiling = new List<Vector2>();
        double floorZSum = 0;
        double maxHorizDist = 0;

        foreach (var p in allPoints)
        {
            var horizDist = MathF.Sqrt(p.X * p.X + p.Y * p.Y);
            if (horizDist > maxHorizDist) maxHorizDist = horizDist;

            if (p.Z < floorThresh)
            {
                floor.Add(new Vector2(p.X, p.Y));
                floorZSum += p.Z;
            }
            else if (p.Z >= obstacleMinZ && p.Z < ceilThresh)
            {
                obstacles.Add(p);
            }
            else
            {
                ceiling.Add(new Vector2(p.X, p.Y));
            }
        }

        var avgFloorZ = floor.Count > 0 ? floorZSum / floor.Count : -4.9;

        // Pass 1: Standard obstacle clustering
        var (clusters, clusterPointIndices) = ClusterObstaclesWithIndices(obstacles, allPoints, floor, avgFloorZ);

        var clusterPoints = new List<Vector3>();
        foreach (var idx in clusterPointIndices)
        {
            clusterPoints.Add(obstacles[idx]);
        }

        // Pass 2: Low-profile obstacle detection in the floor plane
        var lowObstacles = DetectLowProfileObstacles(floor, allPoints, floorThresh, avgFloorZ, clusters.Count);
        lowObstacles = MergeSplitLowObstacles(lowObstacles);
        clusters.AddRange(lowObstacles);

        // For low obstacles, add their floor points to clusterPoints for rendering
        foreach (var lowObs in lowObstacles)
        {
            if (lowObs.OrientedBbox != null && lowObs.OrientedBbox.Length == 4)
            {
                var corners = lowObs.OrientedBbox;
                foreach (var p in allPoints)
                {
                    if (p.Z < (float)(avgFloorZ + 0.05) || p.Z >= (float)floorThresh) continue;
                    if (PointInQuad(p.X, p.Y, corners))
                        clusterPoints.Add(p);
                }
            }
            else
            {
                foreach (var p in allPoints)
                {
                    if (p.X >= (float)lowObs.MinX && p.X <= (float)lowObs.MaxX &&
                        p.Y >= (float)lowObs.MinY && p.Y <= (float)lowObs.MaxY &&
                        p.Z >= (float)(avgFloorZ + 0.05) && p.Z < (float)floorThresh)
                    {
                        clusterPoints.Add(p);
                    }
                }
            }
        }

        _logger.LogInformation(
            "Classified: {Floor} floor, {Obs} obstacle ({ClusterPts} in clusters, {LowObs} low-profile), {Ceil} ceiling. {Clusters} clusters.",
            floor.Count, obstacles.Count, clusterPoints.Count, lowObstacles.Count, ceiling.Count, clusters.Count);

        // Extract wall points: all points near the floor boundary, any Z height (full room outline)
        float fxMin = float.MaxValue, fxMax = float.MinValue;
        float fyMin = float.MaxValue, fyMax = float.MinValue;
        foreach (var p in floor)
        {
            if (p.X < fxMin) fxMin = p.X;
            if (p.X > fxMax) fxMax = p.X;
            if (p.Y < fyMin) fyMin = p.Y;
            if (p.Y > fyMax) fyMax = p.Y;
        }
        float wallBandWidth = 0.6f;
        var wallPoints = new List<Vector2>();
        foreach (var p in allPoints)
        {
            bool nearXBoundary = p.X < fxMin + wallBandWidth || p.X > fxMax - wallBandWidth;
            bool nearYBoundary = p.Y < fyMin + wallBandWidth || p.Y > fyMax - wallBandWidth;
            if (nearXBoundary || nearYBoundary)
                wallPoints.Add(new Vector2(p.X, p.Y));
        }

        return new RplidarScanResult
        {
            Floor = floor,
            Obstacles = obstacles,
            ClusterPoints = clusterPoints,
            Ceiling = ceiling,
            WallPoints = wallPoints,
            Clusters = clusters,
            Meta = new ScanMeta
            {
                TotalPoints = allPoints.Count,
                FloorZ = Math.Round(avgFloorZ, 2),
                CeilingHeight = Math.Round(Math.Abs(avgFloorZ), 2),
                ScanRadius = Math.Round(maxHorizDist, 2),
                FloorThreshold = floorThresh,
                CeilingThreshold = ceilThresh
            }
        };
    }

    private (List<ObstacleCluster> clusters, HashSet<int> pointIndices) ClusterObstaclesWithIndices(
        List<Vector3> obstacles,
        List<Vector3> allPoints,
        List<Vector2> floorPoints,
        double floorZ)
    {
        var validPointIndices = new HashSet<int>();
        var gridSize = ClusterGridSize;
        var minPts = MinClusterPoints;
        var wallMargin = WallMargin;
        var scannerExclusion = ScannerExclusionRadius;
        var groundContactThreshold = (float)(floorZ + GroundContactMargin);
        var maxDimension = MaxObstacleDimension;

        // Compute floor boundary for wall exclusion
        float fxMin = float.MaxValue, fxMax = float.MinValue;
        float fyMin = float.MaxValue, fyMax = float.MinValue;
        foreach (var p in floorPoints)
        {
            if (p.X < fxMin) fxMin = p.X;
            if (p.X > fxMax) fxMax = p.X;
            if (p.Y < fyMin) fyMin = p.Y;
            if (p.Y > fyMax) fyMax = p.Y;
        }

        // Pre-filter obstacle points: exclude wall boundary and scanner vicinity
        var filtered = new List<(int idx, Vector3 pt)>();
        for (int i = 0; i < obstacles.Count; i++)
        {
            var p = obstacles[i];

            if (p.X < fxMin + wallMargin || p.X > fxMax - wallMargin ||
                p.Y < fyMin + wallMargin || p.Y > fyMax - wallMargin)
                continue;

            var horizDist = MathF.Sqrt(p.X * p.X + p.Y * p.Y);
            if (horizDist < scannerExclusion)
                continue;

            filtered.Add((i, p));
        }

        // Grid-based clustering on filtered points
        var cells = new Dictionary<(int gx, int gy), List<int>>();
        for (int i = 0; i < filtered.Count; i++)
        {
            var gx = (int)Math.Floor(filtered[i].pt.X / gridSize);
            var gy = (int)Math.Floor(filtered[i].pt.Y / gridSize);
            var key = (gx, gy);
            if (!cells.ContainsKey(key))
                cells[key] = new List<int>();
            cells[key].Add(i);
        }

        var visited = new HashSet<(int, int)>();
        var clusters = new List<ObstacleCluster>();
        int clusterId = 0;

        foreach (var startCell in cells.Keys)
        {
            if (visited.Contains(startCell)) continue;

            var clusterLocalIndices = new List<int>();
            var stack = new Stack<(int, int)>();
            stack.Push(startCell);

            while (stack.Count > 0)
            {
                var cell = stack.Pop();
                if (visited.Contains(cell) || !cells.ContainsKey(cell)) continue;
                visited.Add(cell);
                clusterLocalIndices.AddRange(cells[cell]);

                for (int dx = -1; dx <= 1; dx++)
                {
                    for (int dy = -1; dy <= 1; dy++)
                    {
                        if (dx == 0 && dy == 0) continue;
                        var neighbor = (cell.Item1 + dx, cell.Item2 + dy);
                        if (!visited.Contains(neighbor) && cells.ContainsKey(neighbor))
                            stack.Push(neighbor);
                    }
                }
            }

            if (clusterLocalIndices.Count < minPts) continue;

            float minX = float.MaxValue, maxX = float.MinValue;
            float minY = float.MaxValue, maxY = float.MinValue;
            double sumX = 0, sumY = 0, sumH = 0;
            float maxH = 0;
            float clusterMinZ = float.MaxValue;

            foreach (var localIdx in clusterLocalIndices)
            {
                var p = filtered[localIdx].pt;
                if (p.X < minX) minX = p.X;
                if (p.X > maxX) maxX = p.X;
                if (p.Y < minY) minY = p.Y;
                if (p.Y > maxY) maxY = p.Y;
                sumX += p.X;
                sumY += p.Y;
                if (p.Z < clusterMinZ) clusterMinZ = p.Z;
                var h = (float)(p.Z - floorZ);
                sumH += h;
                if (h > maxH) maxH = h;
            }

            int n = clusterLocalIndices.Count;
            float w = maxX - minX;
            float d = maxY - minY;

            // Ground contact: cluster must reach within GroundContactMargin of floor
            if (clusterMinZ >= groundContactThreshold) continue;

            // Size check: obstacles larger than MaxObstacleDimension are likely wall remnants
            if (w > maxDimension || d > maxDimension) continue;

            foreach (var localIdx in clusterLocalIndices)
            {
                validPointIndices.Add(filtered[localIdx].idx);
            }

            clusters.Add(new ObstacleCluster
            {
                Id = clusterId++,
                CenterX = Math.Round(sumX / n, 2),
                CenterY = Math.Round(sumY / n, 2),
                MinX = Math.Round(minX, 2),
                MaxX = Math.Round(maxX, 2),
                MinY = Math.Round(minY, 2),
                MaxY = Math.Round(maxY, 2),
                AvgHeight = Math.Round(sumH / n, 2),
                MaxHeight = Math.Round(maxH, 2),
                PointCount = n,
                Width = Math.Round(w, 2),
                Depth = Math.Round(d, 2),
                Type = "obstacle"
            });
        }

        clusters.Sort((a, b) => b.PointCount.CompareTo(a.PointCount));
        return (clusters, validPointIndices);
    }

    /// <summary>
    /// Second-pass detection for low-profile obstacles embedded in the floor plane.
    /// Compares each grid cell's peak Z to its wider neighborhood's baseline Z.
    /// Objects like low sculptures that sit below FloorThreshold are detected here.
    /// </summary>
    private List<ObstacleCluster> DetectLowProfileObstacles(
        List<Vector2> floorPoints2D,
        List<Vector3> allPoints,
        double floorThreshold,
        double avgFloorZ,
        int existingClusterCount)
    {
        var floorPoints3D = allPoints
            .Where(p => p.Z < floorThreshold && p.Z >= floorThreshold - 0.7)
            .ToList();

        if (floorPoints3D.Count < 100) return new List<ObstacleCluster>();

        float fxMin = float.MaxValue, fxMax = float.MinValue;
        float fyMin = float.MaxValue, fyMax = float.MinValue;
        foreach (var p in floorPoints2D)
        {
            if (p.X < fxMin) fxMin = p.X;
            if (p.X > fxMax) fxMax = p.X;
            if (p.Y < fyMin) fyMin = p.Y;
            if (p.Y > fyMax) fyMax = p.Y;
        }

        float gridSize = 0.5f;
        float wallMargin = WallMargin;
        float scannerExclusion = ScannerExclusionRadius;

        var cells = new Dictionary<(int gx, int gy), List<float>>();
        foreach (var p in floorPoints3D)
        {
            if (p.X < fxMin + wallMargin || p.X > fxMax - wallMargin) continue;
            if (p.Y < fyMin + wallMargin || p.Y > fyMax - wallMargin) continue;
            if (MathF.Sqrt(p.X * p.X + p.Y * p.Y) < scannerExclusion) continue;

            var gx = (int)Math.Floor(p.X / gridSize);
            var gy = (int)Math.Floor(p.Y / gridSize);
            var key = (gx, gy);
            if (!cells.ContainsKey(key))
                cells[key] = new List<float>();
            cells[key].Add(p.Z);
        }

        var cellPeaks = new Dictionary<(int, int), float>();
        foreach (var kv in cells)
        {
            var key = kv.Key;
            var zVals = kv.Value;
            if (zVals.Count < 5) continue;
            zVals.Sort();
            int idx90 = (int)(zVals.Count * 0.9);
            cellPeaks[key] = zVals[Math.Min(idx90, zVals.Count - 1)];
        }

        var anomalyCells = new Dictionary<(int, int), (float cx, float cy, float elevation, int nPts)>();
        foreach (var kv in cellPeaks)
        {
            var key = kv.Key;
            var peakZ = kv.Value;
            var neighborBases = new List<float>();
            for (int dx = -3; dx <= 3; dx++)
            {
                for (int dy = -3; dy <= 3; dy++)
                {
                    if (Math.Abs(dx) <= 1 && Math.Abs(dy) <= 1) continue;
                    var nk = (key.Item1 + dx, key.Item2 + dy);
                    if (cellPeaks.ContainsKey(nk))
                        neighborBases.Add(cellPeaks[nk]);
                }
            }

            if (neighborBases.Count < 5) continue;

            neighborBases.Sort();
            float localFloor = neighborBases[neighborBases.Count / 4];
            float elevation = peakZ - localFloor;

            // Require at least 20cm above local floor
            // (15cm picks up scanner cone gradient; 20cm isolates real objects)
            if (elevation > 0.20f)
            {
                float cx = key.Item1 * gridSize + gridSize / 2;
                float cy = key.Item2 * gridSize + gridSize / 2;
                anomalyCells[key] = (cx, cy, elevation, cells[key].Count);
            }
        }

        if (anomalyCells.Count == 0) return new List<ObstacleCluster>();

        var visited = new HashSet<(int, int)>();
        var lowObstacles = new List<ObstacleCluster>();
        int clusterId = existingClusterCount;

        foreach (var startCell in anomalyCells.Keys)
        {
            if (visited.Contains(startCell)) continue;

            var clusterCells = new List<(int, int)>();
            var stack = new Stack<(int, int)>();
            stack.Push(startCell);

            while (stack.Count > 0)
            {
                var cell = stack.Pop();
                if (visited.Contains(cell) || !anomalyCells.ContainsKey(cell)) continue;
                visited.Add(cell);
                clusterCells.Add(cell);

                for (int dx = -1; dx <= 1; dx++)
                {
                    for (int dy = -1; dy <= 1; dy++)
                    {
                        if (dx == 0 && dy == 0) continue;
                        var neighbor = (cell.Item1 + dx, cell.Item2 + dy);
                        if (!visited.Contains(neighbor) && anomalyCells.ContainsKey(neighbor))
                            stack.Push(neighbor);
                    }
                }
            }

            int totalPoints = clusterCells.Sum(c => anomalyCells[c].nPts);
            if (clusterCells.Count < 3 || totalPoints < 20) continue;

            var cxs = clusterCells.Select(c => anomalyCells[c].cx).ToList();
            var cys = clusterCells.Select(c => anomalyCells[c].cy).ToList();
            var elevations = clusterCells.Select(c => anomalyCells[c].elevation).ToList();

            // Compute oriented bounding box via PCA
            float meanX = cxs.Average();
            float meanY = cys.Average();
            double cxx = 0, cxy = 0, cyy = 0;
            for (int k = 0; k < cxs.Count; k++)
            {
                double dx = cxs[k] - meanX;
                double dy = cys[k] - meanY;
                cxx += dx * dx;
                cxy += dx * dy;
                cyy += dy * dy;
            }
            cxx /= cxs.Count;
            cxy /= cxs.Count;
            cyy /= cys.Count;
            double angle = 0.5 * Math.Atan2(2 * cxy, cxx - cyy);
            double cosA = Math.Cos(-angle);
            double sinA = Math.Sin(-angle);
            double rMinX = double.MaxValue, rMaxX = double.MinValue;
            double rMinY = double.MaxValue, rMaxY = double.MinValue;
            for (int k = 0; k < cxs.Count; k++)
            {
                double dx = cxs[k] - meanX;
                double dy = cys[k] - meanY;
                double rx = dx * cosA - dy * sinA;
                double ry = dx * sinA + dy * cosA;
                if (rx < rMinX) rMinX = rx;
                if (rx > rMaxX) rMaxX = rx;
                if (ry < rMinY) rMinY = ry;
                if (ry > rMaxY) rMaxY = ry;
            }
            rMinX -= gridSize / 2;
            rMaxX += gridSize / 2;
            rMinY -= gridSize / 2;
            rMaxY += gridSize / 2;
            double obbW = rMaxX - rMinX;
            double obbD = rMaxY - rMinY;
            double shortDim = Math.Min(obbW, obbD);
            if (shortDim > MaxObstacleDimension) continue;

            double cosB = Math.Cos(angle);
            double sinB = Math.Sin(angle);
            var corners = new double[4][];
            var rotCorners = new (double x, double y)[]
            {
                (rMinX, rMinY), (rMaxX, rMinY), (rMaxX, rMaxY), (rMinX, rMaxY)
            };
            for (int k = 0; k < 4; k++)
            {
                double wx = rotCorners[k].x * cosB - rotCorners[k].y * sinB + meanX;
                double wy = rotCorners[k].x * sinB + rotCorners[k].y * cosB + meanY;
                corners[k] = new[] { Math.Round(wx, 2), Math.Round(wy, 2) };
            }
            float minX = (float)corners.Min(c => c[0]);
            float maxX = (float)corners.Max(c => c[0]);
            float minY = (float)corners.Min(c => c[1]);
            float maxY = (float)corners.Max(c => c[1]);
            float avgElevation = elevations.Average();

            lowObstacles.Add(new ObstacleCluster
            {
                Id = clusterId++,
                CenterX = Math.Round(meanX, 2),
                CenterY = Math.Round(meanY, 2),
                MinX = Math.Round(minX, 2),
                MaxX = Math.Round(maxX, 2),
                MinY = Math.Round(minY, 2),
                MaxY = Math.Round(maxY, 2),
                AvgHeight = Math.Round(avgElevation, 2),
                MaxHeight = Math.Round(elevations.Max(), 2),
                PointCount = totalPoints,
                Width = Math.Round(obbW, 2),
                Depth = Math.Round(obbD, 2),
                Type = "low_obstacle",
                OrientedBbox = corners,
                RotationDeg = Math.Round(angle * 180.0 / Math.PI, 1)
            });
        }

        lowObstacles.Sort((a, b) => b.PointCount.CompareTo(a.PointCount));
        return lowObstacles;
    }

    /// <summary>
    /// Merge low-profile obstacle clusters that are likely the same object
    /// split by scanner shadow. Two clusters merge when they have similar
    /// rotation angle and similar elevation — indicating the same diagonal
    /// object split by the overhead structure's shadow.
    /// </summary>
    private List<ObstacleCluster> MergeSplitLowObstacles(List<ObstacleCluster> lowObstacles)
    {
        if (lowObstacles.Count < 2) return lowObstacles;

        float maxAngleDiff = 15f;    // degrees — same object should have similar angle
        float maxElevDiff = 0.10f;   // meters — similar elevation
        float maxCenterDist = 12f;   // meters — sanity check, don't merge distant clusters

        var merged = new List<ObstacleCluster>(lowObstacles);
        bool didMerge;

        do
        {
            didMerge = false;
            for (int i = 0; i < merged.Count && !didMerge; i++)
            {
                for (int j = i + 1; j < merged.Count && !didMerge; j++)
                {
                    var a = merged[i];
                    var b = merged[j];

                    if (Math.Abs(a.AvgHeight - b.AvgHeight) > maxElevDiff) continue;

                    double angleDiff = Math.Abs(a.RotationDeg - b.RotationDeg);
                    if (angleDiff > 180) angleDiff = 360 - angleDiff;
                    if (angleDiff > maxAngleDiff) continue;

                    double dist = Math.Sqrt(
                        Math.Pow(a.CenterX - b.CenterX, 2) +
                        Math.Pow(a.CenterY - b.CenterY, 2));
                    if (dist > maxCenterDist) continue;

                    var allCorners = new List<double[]>();
                    if (a.OrientedBbox != null) allCorners.AddRange(a.OrientedBbox);
                    else allCorners.AddRange(new[] {
                        new[] { a.MinX, a.MinY }, new[] { a.MaxX, a.MinY },
                        new[] { a.MaxX, a.MaxY }, new[] { a.MinX, a.MaxY } });
                    if (b.OrientedBbox != null) allCorners.AddRange(b.OrientedBbox);
                    else allCorners.AddRange(new[] {
                        new[] { b.MinX, b.MinY }, new[] { b.MaxX, b.MinY },
                        new[] { b.MaxX, b.MaxY }, new[] { b.MinX, b.MaxY } });

                    double mx = allCorners.Average(c => c[0]);
                    double my = allCorners.Average(c => c[1]);
                    double cvxx = 0, cvxy = 0, cvyy = 0;
                    foreach (var c in allCorners)
                    {
                        double ddx = c[0] - mx, ddy = c[1] - my;
                        cvxx += ddx * ddx; cvxy += ddx * ddy; cvyy += ddy * ddy;
                    }
                    double ang = 0.5 * Math.Atan2(2 * cvxy, cvxx - cvyy);
                    double ca = Math.Cos(-ang), sa = Math.Sin(-ang);
                    double rxMin = double.MaxValue, rxMax = double.MinValue;
                    double ryMin = double.MaxValue, ryMax = double.MinValue;
                    foreach (var c in allCorners)
                    {
                        double ddx = c[0] - mx, ddy = c[1] - my;
                        double rx = ddx * ca - ddy * sa;
                        double ry = ddx * sa + ddy * ca;
                        if (rx < rxMin) rxMin = rx; if (rx > rxMax) rxMax = rx;
                        if (ry < ryMin) ryMin = ry; if (ry > ryMax) ryMax = ry;
                    }
                    double cb = Math.Cos(ang), sb = Math.Sin(ang);
                    var newCorners = new double[4][];
                    var rc = new (double x, double y)[]
                    {
                        (rxMin, ryMin), (rxMax, ryMin), (rxMax, ryMax), (rxMin, ryMax)
                    };
                    for (int k = 0; k < 4; k++)
                    {
                        newCorners[k] = new[]
                        {
                            Math.Round(rc[k].x * cb - rc[k].y * sb + mx, 2),
                            Math.Round(rc[k].x * sb + rc[k].y * cb + my, 2)
                        };
                    }

                    var m = new ObstacleCluster
                    {
                        Id = a.Id,
                        CenterX = Math.Round(mx, 2),
                        CenterY = Math.Round(my, 2),
                        MinX = Math.Round(newCorners.Min(c => c[0]), 2),
                        MaxX = Math.Round(newCorners.Max(c => c[0]), 2),
                        MinY = Math.Round(newCorners.Min(c => c[1]), 2),
                        MaxY = Math.Round(newCorners.Max(c => c[1]), 2),
                        PointCount = a.PointCount + b.PointCount,
                        AvgHeight = Math.Round(
                            (a.AvgHeight * a.PointCount + b.AvgHeight * b.PointCount) /
                            (a.PointCount + b.PointCount), 2),
                        MaxHeight = Math.Max(a.MaxHeight, b.MaxHeight),
                        Width = Math.Round(rxMax - rxMin, 2),
                        Depth = Math.Round(ryMax - ryMin, 2),
                        Type = "low_obstacle",
                        OrientedBbox = newCorners,
                        RotationDeg = Math.Round(ang * 180.0 / Math.PI, 1)
                    };

                    merged[i] = m;
                    merged.RemoveAt(j);
                    didMerge = true;
                }
            }
        } while (didMerge);

        return merged;
    }

    private static bool PointInQuad(float px, float py, double[][] corners)
    {
        for (int i = 0; i < 4; i++)
        {
            int j = (i + 1) % 4;
            double ex = corners[j][0] - corners[i][0];
            double ey = corners[j][1] - corners[i][1];
            double tx = px - corners[i][0];
            double ty = py - corners[i][1];
            if (ex * ty - ey * tx < 0) return false;
        }
        return true;
    }
}

// ─── DTOs ───

public class RplidarScanResult
{
    public List<Vector2> Floor { get; set; } = new();
    public List<Vector3> Obstacles { get; set; } = new();       // All points in obstacle Z-band (for context rendering)
    public List<Vector3> ClusterPoints { get; set; } = new();  // Only points in valid clusters (for highlighting)
    public List<Vector2> Ceiling { get; set; } = new();
    public List<Vector2> WallPoints { get; set; } = new();     // Points near floor boundary, any Z (full room outline)
    public List<ObstacleCluster> Clusters { get; set; } = new();
    public ScanMeta Meta { get; set; } = new();
}

public class ScanMeta
{
    public int TotalPoints { get; set; }
    public double FloorZ { get; set; }
    public double CeilingHeight { get; set; }
    public double ScanRadius { get; set; }
    public double FloorThreshold { get; set; }
    public double CeilingThreshold { get; set; }
}

public class ObstacleCluster
{
    public int Id { get; set; }
    public double CenterX { get; set; }
    public double CenterY { get; set; }
    public double MinX { get; set; }
    public double MaxX { get; set; }
    public double MinY { get; set; }
    public double MaxY { get; set; }
    public double AvgHeight { get; set; }
    public double MaxHeight { get; set; }
    public int PointCount { get; set; }
    public double Width { get; set; }
    public double Depth { get; set; }
    public string Type { get; set; } = "obstacle";
    /// <summary>For rotated obstacles: 4 corners of the oriented bounding box [x,y] pairs. Null for axis-aligned.</summary>
    public double[][]? OrientedBbox { get; set; }
    /// <summary>Rotation angle in degrees (0 = axis-aligned).</summary>
    public double RotationDeg { get; set; } = 0;
}

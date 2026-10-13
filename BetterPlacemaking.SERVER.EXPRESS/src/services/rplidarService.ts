import { env } from "../config/env.js";
import { getWorkstation } from "../workstation/index.js";
import type { LidarPoint3D, ObstacleCluster, Point2, Point3, RplidarScanResult, ScanFileInfo } from "../models/rplidar.js";

/**
 * Ported from BetterPlacemaking.SERVER/Services/Rplidar/RplidarScanService.cs.
 * Processes already-captured RPLidar `.xyz` scan files - pure point-cloud math,
 * no hardware/serial access - into floor/ceiling/obstacle-classified point
 * clouds with grid-based obstacle clustering. Each exported/internal function
 * below is commented with the C# method it mirrors.
 *
 * Every threshold/margin constant is a physical calibration value (meters,
 * relative to the RPLidar's ceiling-mount height) sourced from config/env.ts
 * (RplidarScan:* in the old appsettings.json) - see the comment on each call
 * site below for what it means. A handful of *additional* constants are
 * hard-coded in RplidarScanService.cs itself (not configurable in the old
 * appsettings.json either) - those are preserved here as literals with the
 * same comments the original inlines.
 */

// ─── Rounding ───

/**
 * C#'s Math.Round(double, digits) defaults to MidpointRounding.ToEven ("banker's
 * rounding") - it rounds an exact .5 at the target digit to the nearest *even*
 * digit, unlike JS's Math.round (which always rounds half away from zero). Every
 * Math.Round(x, 2) / Math.Round(x, 1) call in RplidarScanService.cs is ported
 * using this helper instead of a naive Math.round-based one, so exact-midpoint
 * inputs round identically. In practice this is extremely unlikely to matter for
 * real sensor floats (an exact ...xx5 value at 2/1 decimal digits is rare), but
 * it's kept faithful rather than assumed irrelevant.
 */
export function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floorVal = Math.floor(scaled);
  const diff = scaled - floorVal;
  const epsilon = 1e-9;
  let rounded: number;
  if (Math.abs(diff - 0.5) < epsilon) {
    rounded = floorVal % 2 === 0 ? floorVal : floorVal + 1;
  } else {
    rounded = Math.round(scaled);
  }
  return rounded / factor;
}

// ─── Configuration (from config/env.ts, mirrors RplidarScanService.cs's IConfiguration-backed properties) ───

/** RplidarScan:FloorThreshold - default -4.3m. Points below this Z are classified as floor. */
function floorThresholdConfig(): number {
  return env.rplidarFloorThreshold;
}

/** RplidarScan:CeilingThreshold - default -1.0m. Points at/above this Z are classified as ceiling. */
function ceilingThresholdConfig(): number {
  return env.rplidarCeilingThreshold;
}

/** RplidarScan:ClusterGridSize - default 0.4m. XY grid cell size used for pass-1 obstacle clustering. */
function clusterGridSizeConfig(): number {
  return env.rplidarClusterGridSize;
}

/** RplidarScan:MinClusterPoints - default 10. Minimum connected-cell point count to keep a pass-1 cluster. */
function minClusterPointsConfig(): number {
  return env.rplidarMinClusterPoints;
}

/** RplidarScan:WallMargin - default 0.8m. Obstacle points within this distance of the floor's XY bounding box edge are excluded (likely wall/structure noise, not a real obstacle). */
function wallMarginConfig(): number {
  return env.rplidarWallMargin;
}

/** RplidarScan:ScannerExclusionRadius - default 2.0m. Obstacle points within this horizontal distance of the sensor origin are excluded (scanner mount / self-occlusion noise). */
function scannerExclusionRadiusConfig(): number {
  return env.rplidarScannerExclusionRadius;
}

/** RplidarScan:GroundContactMargin - default 0.9m. A cluster must have at least one point within this height of the floor to count as a real (floor-standing) obstacle, not ceiling-mounted debris. */
function groundContactMarginConfig(): number {
  return env.rplidarGroundContactMargin;
}

/** RplidarScan:MaxObstacleDimension - default 5.0m. Clusters wider/deeper than this are rejected as likely wall remnants rather than discrete obstacles. */
function maxObstacleDimensionConfig(): number {
  return env.rplidarMaxObstacleDimension;
}

// ─── Public API ───

/** Mirrors RplidarScanService.ParseXyzFile. */
export async function parseXyzFile(filePath: string): Promise<RplidarScanResult> {
  const content = await getWorkstation().readText(filePath);
  const lines = content.split(/\r\n|\r|\n/);
  // File.ReadAllLines does not yield a trailing empty entry for a file ending in
  // a newline; String.split does, so drop it to match.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const allPoints = parseXyzLines(lines);
  return classifyAndCluster(allPoints);
}

/** Mirrors RplidarScanService.ParseXyzText (for API upload scenarios). */
export function parseXyzText(xyzText: string): RplidarScanResult {
  const lines = xyzText.split("\n").filter((l) => l.length > 0);
  const allPoints = parseXyzLines(lines);
  return classifyAndCluster(allPoints);
}

/** Shared point-line parser for ParseXyzFile/ParseXyzText - mirrors both methods' identical parse loop. */
function parseXyzLines(lines: string[]): Point3[] {
  const allPoints: Point3[] = [];
  for (const line of lines) {
    // C# splits on a literal ' ' with RemoveEmptyEntries (not a general whitespace regex).
    const parts = line.trim().split(" ").filter((s) => s.length > 0);
    if (parts.length >= 3) {
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const z = Number(parts[2]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        allPoints.push({ X: x, Y: y, Z: z });
      }
    }
  }
  return allPoints;
}

/**
 * Mirrors RplidarScanService.Reclassify - re-classify an already-parsed scan
 * with caller-supplied thresholds instead of the configured defaults. Exposed
 * for parity with the C# service's public surface; no current route wires this
 * up (RplidarController.GetScan accepts floorThreshold/ceilingThreshold query
 * params but never forwards them to a Reclassify call in the original either -
 * see rplidar.routes.ts).
 */
export function reclassify(allPoints: Point3[], floorThreshold: number, ceilingThreshold: number): RplidarScanResult {
  return classifyAndCluster(allPoints, floorThreshold, ceilingThreshold);
}

/**
 * Mirrors RplidarScanService.ParseFromPointCloud - runs classification on an
 * in-memory point cloud (e.g. from the 3D visualizer session), converting
 * centimeters to meters first so thresholds/clustering match file-based `.xyz`
 * behavior. Kept for parity/future wiring; no route currently sources real
 * points for it (VisualizerController.SnapshotCurrentPointsForRplidar's
 * in-memory session is a separate, not-yet-ported subsystem - see
 * rplidar.routes.ts's `from-scan` handler).
 */
export function parseFromPointCloud(points: LidarPoint3D[]): RplidarScanResult {
  if (!points || points.length === 0) {
    throw new Error("No points provided.");
  }
  const inMeters: Point3[] = points.map((p) => ({
    X: p.X / 100.0,
    Y: p.Y / 100.0,
    Z: p.Z / 100.0,
  }));
  return classifyAndCluster(inMeters);
}

/** Mirrors RplidarController.ListScans's directory listing (kept in the service since it's filesystem I/O, matching trackingService.ts's convention). */
export async function listScanFiles(directory: string): Promise<ScanFileInfo[]> {
  const ws = getWorkstation();
  if (!(await ws.exists(directory))) return [];

  const files = (await ws.listStats(directory))
    .filter((f) => f.name.toLowerCase().endsWith(".xyz"))
    .map((f) => ({ filename: f.name, sizeBytes: f.size, modified: new Date(f.mtimeMs).toISOString() }));

  files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return files;
}

// ─── Core Processing ───

/** Mirrors RplidarScanService.ClassifyAndCluster. */
function classifyAndCluster(allPoints: Point3[], floorThreshOverride?: number, ceilThreshOverride?: number): RplidarScanResult {
  const floorThresh = floorThreshOverride ?? floorThresholdConfig();
  const ceilThresh = ceilThreshOverride ?? ceilingThresholdConfig();

  // Classify by Z-height. Note: do NOT add a noise margin here - it clips real
  // obstacle bases. The ground-contact check in clustering handles floor noise
  // rejection instead.
  const obstacleMinZ = floorThresh;

  const floor: Point2[] = [];
  const obstacles: Point3[] = [];
  const ceiling: Point2[] = [];
  let floorZSum = 0;
  let maxHorizDist = 0;

  for (const p of allPoints) {
    const horizDist = Math.sqrt(p.X * p.X + p.Y * p.Y);
    if (horizDist > maxHorizDist) maxHorizDist = horizDist;

    if (p.Z < floorThresh) {
      floor.push({ X: p.X, Y: p.Y });
      floorZSum += p.Z;
    } else if (p.Z >= obstacleMinZ && p.Z < ceilThresh) {
      obstacles.push(p);
    } else {
      ceiling.push({ X: p.X, Y: p.Y });
    }
  }

  const avgFloorZ = floor.length > 0 ? floorZSum / floor.length : -4.9;

  // Pass 1: standard obstacle clustering.
  const { clusters, pointIndices: clusterPointIndices } = clusterObstaclesWithIndices(obstacles, floor, avgFloorZ);

  const clusterPoints: Point3[] = [];
  for (const idx of clusterPointIndices) {
    clusterPoints.push(obstacles[idx]);
  }

  // Pass 2: low-profile obstacle detection in the floor plane.
  let lowObstacles = detectLowProfileObstacles(floor, allPoints, floorThresh, avgFloorZ, clusters.length);
  lowObstacles = mergeSplitLowObstacles(lowObstacles);
  clusters.push(...lowObstacles);

  // For low obstacles, add their floor points to clusterPoints for rendering.
  for (const lowObs of lowObstacles) {
    if (lowObs.OrientedBbox && lowObs.OrientedBbox.length === 4) {
      const corners = lowObs.OrientedBbox;
      for (const p of allPoints) {
        if (p.Z < avgFloorZ + 0.05 || p.Z >= floorThresh) continue;
        if (pointInQuad(p.X, p.Y, corners)) clusterPoints.push(p);
      }
    } else {
      for (const p of allPoints) {
        if (
          p.X >= lowObs.MinX &&
          p.X <= lowObs.MaxX &&
          p.Y >= lowObs.MinY &&
          p.Y <= lowObs.MaxY &&
          p.Z >= avgFloorZ + 0.05 &&
          p.Z < floorThresh
        ) {
          clusterPoints.push(p);
        }
      }
    }
  }

  // Extract wall points: all points near the floor boundary, any Z height (full room outline).
  let fxMin = Number.POSITIVE_INFINITY;
  let fxMax = Number.NEGATIVE_INFINITY;
  let fyMin = Number.POSITIVE_INFINITY;
  let fyMax = Number.NEGATIVE_INFINITY;
  for (const p of floor) {
    if (p.X < fxMin) fxMin = p.X;
    if (p.X > fxMax) fxMax = p.X;
    if (p.Y < fyMin) fyMin = p.Y;
    if (p.Y > fyMax) fyMax = p.Y;
  }
  const wallBandWidth = 0.6; // meters - fixed in the original (not configurable), band width for the room-outline extraction below.
  const wallPoints: Point2[] = [];
  for (const p of allPoints) {
    const nearXBoundary = p.X < fxMin + wallBandWidth || p.X > fxMax - wallBandWidth;
    const nearYBoundary = p.Y < fyMin + wallBandWidth || p.Y > fyMax - wallBandWidth;
    if (nearXBoundary || nearYBoundary) wallPoints.push({ X: p.X, Y: p.Y });
  }

  return {
    Floor: floor,
    Obstacles: obstacles,
    ClusterPoints: clusterPoints,
    Ceiling: ceiling,
    WallPoints: wallPoints,
    Clusters: clusters,
    Meta: {
      TotalPoints: allPoints.length,
      FloorZ: roundTo(avgFloorZ, 2),
      CeilingHeight: roundTo(Math.abs(avgFloorZ), 2),
      ScanRadius: roundTo(maxHorizDist, 2),
      FloorThreshold: floorThresh,
      CeilingThreshold: ceilThresh,
    },
  };
}

/** Mirrors RplidarScanService.ClusterObstaclesWithIndices. */
function clusterObstaclesWithIndices(
  obstacles: Point3[],
  floorPoints: Point2[],
  floorZ: number,
): { clusters: ObstacleCluster[]; pointIndices: Set<number> } {
  const validPointIndices = new Set<number>();
  const gridSize = clusterGridSizeConfig();
  const minPts = minClusterPointsConfig();
  const wallMargin = wallMarginConfig();
  const scannerExclusion = scannerExclusionRadiusConfig();
  const groundContactThreshold = floorZ + groundContactMarginConfig();
  const maxDimension = maxObstacleDimensionConfig();

  // Compute floor boundary for wall exclusion.
  let fxMin = Number.POSITIVE_INFINITY;
  let fxMax = Number.NEGATIVE_INFINITY;
  let fyMin = Number.POSITIVE_INFINITY;
  let fyMax = Number.NEGATIVE_INFINITY;
  for (const p of floorPoints) {
    if (p.X < fxMin) fxMin = p.X;
    if (p.X > fxMax) fxMax = p.X;
    if (p.Y < fyMin) fyMin = p.Y;
    if (p.Y > fyMax) fyMax = p.Y;
  }

  // Pre-filter obstacle points: exclude wall boundary and scanner vicinity.
  const filtered: { idx: number; pt: Point3 }[] = [];
  for (let i = 0; i < obstacles.length; i++) {
    const p = obstacles[i];

    if (p.X < fxMin + wallMargin || p.X > fxMax - wallMargin || p.Y < fyMin + wallMargin || p.Y > fyMax - wallMargin) {
      continue;
    }

    const horizDist = Math.sqrt(p.X * p.X + p.Y * p.Y);
    if (horizDist < scannerExclusion) continue;

    filtered.push({ idx: i, pt: p });
  }

  // Grid-based clustering on filtered points.
  const cells = new Map<string, number[]>();
  for (let i = 0; i < filtered.length; i++) {
    const gx = Math.floor(filtered[i].pt.X / gridSize);
    const gy = Math.floor(filtered[i].pt.Y / gridSize);
    const key = `${gx},${gy}`;
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = [];
      cells.set(key, bucket);
    }
    bucket.push(i);
  }

  const visited = new Set<string>();
  const clusters: ObstacleCluster[] = [];
  let clusterId = 0;

  for (const startCell of cells.keys()) {
    if (visited.has(startCell)) continue;

    const clusterLocalIndices: number[] = [];
    const stack: string[] = [startCell];

    while (stack.length > 0) {
      const cellKey = stack.pop()!;
      if (visited.has(cellKey) || !cells.has(cellKey)) continue;
      visited.add(cellKey);
      clusterLocalIndices.push(...cells.get(cellKey)!);

      const [cgx, cgy] = cellKey.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const neighborKey = `${cgx + dx},${cgy + dy}`;
          if (!visited.has(neighborKey) && cells.has(neighborKey)) stack.push(neighborKey);
        }
      }
    }

    if (clusterLocalIndices.length < minPts) continue;

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let sumX = 0;
    let sumY = 0;
    let sumH = 0;
    let maxH = 0;
    let clusterMinZ = Number.POSITIVE_INFINITY;

    for (const localIdx of clusterLocalIndices) {
      const p = filtered[localIdx].pt;
      if (p.X < minX) minX = p.X;
      if (p.X > maxX) maxX = p.X;
      if (p.Y < minY) minY = p.Y;
      if (p.Y > maxY) maxY = p.Y;
      sumX += p.X;
      sumY += p.Y;
      if (p.Z < clusterMinZ) clusterMinZ = p.Z;
      const h = p.Z - floorZ;
      sumH += h;
      if (h > maxH) maxH = h;
    }

    const n = clusterLocalIndices.length;
    const w = maxX - minX;
    const d = maxY - minY;

    // Ground contact: cluster must reach within GroundContactMargin of the floor.
    if (clusterMinZ >= groundContactThreshold) continue;

    // Size check: obstacles larger than MaxObstacleDimension are likely wall remnants.
    if (w > maxDimension || d > maxDimension) continue;

    for (const localIdx of clusterLocalIndices) {
      validPointIndices.add(filtered[localIdx].idx);
    }

    clusters.push({
      Id: clusterId++,
      CenterX: roundTo(sumX / n, 2),
      CenterY: roundTo(sumY / n, 2),
      MinX: roundTo(minX, 2),
      MaxX: roundTo(maxX, 2),
      MinY: roundTo(minY, 2),
      MaxY: roundTo(maxY, 2),
      AvgHeight: roundTo(sumH / n, 2),
      MaxHeight: roundTo(maxH, 2),
      PointCount: n,
      Width: roundTo(w, 2),
      Depth: roundTo(d, 2),
      Type: "obstacle",
      RotationDeg: 0,
    });
  }

  clusters.sort((a, b) => b.PointCount - a.PointCount);
  return { clusters, pointIndices: validPointIndices };
}

/**
 * Mirrors RplidarScanService.DetectLowProfileObstacles. Second-pass detection
 * for low-profile obstacles embedded in the floor plane. Compares each grid
 * cell's peak Z to its wider neighborhood's baseline Z. Objects like low
 * sculptures that sit below FloorThreshold are detected here.
 */
function detectLowProfileObstacles(
  floorPoints2D: Point2[],
  allPoints: Point3[],
  floorThreshold: number,
  avgFloorZ: number,
  existingClusterCount: number,
): ObstacleCluster[] {
  const floorPoints3D = allPoints.filter((p) => p.Z < floorThreshold && p.Z >= floorThreshold - 0.7);

  if (floorPoints3D.length < 100) return [];

  let fxMin = Number.POSITIVE_INFINITY;
  let fxMax = Number.NEGATIVE_INFINITY;
  let fyMin = Number.POSITIVE_INFINITY;
  let fyMax = Number.NEGATIVE_INFINITY;
  for (const p of floorPoints2D) {
    if (p.X < fxMin) fxMin = p.X;
    if (p.X > fxMax) fxMax = p.X;
    if (p.Y < fyMin) fyMin = p.Y;
    if (p.Y > fyMax) fyMax = p.Y;
  }

  const gridSize = 0.5; // meters - fixed in the original (distinct from the configurable ClusterGridSize used in pass 1).
  const wallMargin = wallMarginConfig();
  const scannerExclusion = scannerExclusionRadiusConfig();

  const cells = new Map<string, number[]>();
  for (const p of floorPoints3D) {
    if (p.X < fxMin + wallMargin || p.X > fxMax - wallMargin) continue;
    if (p.Y < fyMin + wallMargin || p.Y > fyMax - wallMargin) continue;
    if (Math.sqrt(p.X * p.X + p.Y * p.Y) < scannerExclusion) continue;

    const gx = Math.floor(p.X / gridSize);
    const gy = Math.floor(p.Y / gridSize);
    const key = `${gx},${gy}`;
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = [];
      cells.set(key, bucket);
    }
    bucket.push(p.Z);
  }

  const cellPeaks = new Map<string, number>();
  for (const [key, zVals] of cells) {
    if (zVals.length < 5) continue;
    const sorted = [...zVals].sort((a, b) => a - b);
    const idx90 = Math.floor(sorted.length * 0.9);
    cellPeaks.set(key, sorted[Math.min(idx90, sorted.length - 1)]);
  }

  const anomalyCells = new Map<string, { cx: number; cy: number; elevation: number; nPts: number }>();
  for (const [key, peakZ] of cellPeaks) {
    const [kgx, kgy] = key.split(",").map(Number);
    const neighborBases: number[] = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) continue;
        const nk = `${kgx + dx},${kgy + dy}`;
        const nz = cellPeaks.get(nk);
        if (nz !== undefined) neighborBases.push(nz);
      }
    }

    if (neighborBases.length < 5) continue;

    neighborBases.sort((a, b) => a - b);
    const localFloor = neighborBases[Math.floor(neighborBases.length / 4)];
    const elevation = peakZ - localFloor;

    // Require at least 20cm above local floor (15cm picks up scanner cone
    // gradient; 20cm isolates real objects) - fixed in the original.
    if (elevation > 0.2) {
      const cx = kgx * gridSize + gridSize / 2;
      const cy = kgy * gridSize + gridSize / 2;
      anomalyCells.set(key, { cx, cy, elevation, nPts: cells.get(key)!.length });
    }
  }

  if (anomalyCells.size === 0) return [];

  const visited = new Set<string>();
  const lowObstacles: ObstacleCluster[] = [];
  let clusterId = existingClusterCount;

  for (const startCell of anomalyCells.keys()) {
    if (visited.has(startCell)) continue;

    const clusterCellKeys: string[] = [];
    const stack: string[] = [startCell];

    while (stack.length > 0) {
      const cellKey = stack.pop()!;
      if (visited.has(cellKey) || !anomalyCells.has(cellKey)) continue;
      visited.add(cellKey);
      clusterCellKeys.push(cellKey);

      const [cgx, cgy] = cellKey.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const neighborKey = `${cgx + dx},${cgy + dy}`;
          if (!visited.has(neighborKey) && anomalyCells.has(neighborKey)) stack.push(neighborKey);
        }
      }
    }

    const clusterCells = clusterCellKeys.map((k) => anomalyCells.get(k)!);
    const totalPoints = clusterCells.reduce((sum, c) => sum + c.nPts, 0);
    if (clusterCells.length < 3 || totalPoints < 20) continue;

    const cxs = clusterCells.map((c) => c.cx);
    const cys = clusterCells.map((c) => c.cy);
    const elevations = clusterCells.map((c) => c.elevation);

    // Compute oriented bounding box via PCA.
    const meanX = cxs.reduce((a, b) => a + b, 0) / cxs.length;
    const meanY = cys.reduce((a, b) => a + b, 0) / cys.length;
    let cxx = 0;
    let cxy = 0;
    let cyy = 0;
    for (let k = 0; k < cxs.length; k++) {
      const dx = cxs[k] - meanX;
      const dy = cys[k] - meanY;
      cxx += dx * dx;
      cxy += dx * dy;
      cyy += dy * dy;
    }
    cxx /= cxs.length;
    cxy /= cxs.length;
    cyy /= cys.length;
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const cosA = Math.cos(-angle);
    const sinA = Math.sin(-angle);
    let rMinX = Number.POSITIVE_INFINITY;
    let rMaxX = Number.NEGATIVE_INFINITY;
    let rMinY = Number.POSITIVE_INFINITY;
    let rMaxY = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < cxs.length; k++) {
      const dx = cxs[k] - meanX;
      const dy = cys[k] - meanY;
      const rx = dx * cosA - dy * sinA;
      const ry = dx * sinA + dy * cosA;
      if (rx < rMinX) rMinX = rx;
      if (rx > rMaxX) rMaxX = rx;
      if (ry < rMinY) rMinY = ry;
      if (ry > rMaxY) rMaxY = ry;
    }
    rMinX -= gridSize / 2;
    rMaxX += gridSize / 2;
    rMinY -= gridSize / 2;
    rMaxY += gridSize / 2;
    const obbW = rMaxX - rMinX;
    const obbD = rMaxY - rMinY;
    const shortDim = Math.min(obbW, obbD);
    if (shortDim > maxObstacleDimensionConfig()) continue;

    const cosB = Math.cos(angle);
    const sinB = Math.sin(angle);
    const rotCorners: [number, number][] = [
      [rMinX, rMinY],
      [rMaxX, rMinY],
      [rMaxX, rMaxY],
      [rMinX, rMaxY],
    ];
    const corners: number[][] = rotCorners.map(([rx, ry]) => {
      const wx = rx * cosB - ry * sinB + meanX;
      const wy = rx * sinB + ry * cosB + meanY;
      return [roundTo(wx, 2), roundTo(wy, 2)];
    });
    const minX = Math.min(...corners.map((c) => c[0]));
    const maxX = Math.max(...corners.map((c) => c[0]));
    const minY = Math.min(...corners.map((c) => c[1]));
    const maxY = Math.max(...corners.map((c) => c[1]));
    const avgElevation = elevations.reduce((a, b) => a + b, 0) / elevations.length;

    lowObstacles.push({
      Id: clusterId++,
      CenterX: roundTo(meanX, 2),
      CenterY: roundTo(meanY, 2),
      MinX: roundTo(minX, 2),
      MaxX: roundTo(maxX, 2),
      MinY: roundTo(minY, 2),
      MaxY: roundTo(maxY, 2),
      AvgHeight: roundTo(avgElevation, 2),
      MaxHeight: roundTo(Math.max(...elevations), 2),
      PointCount: totalPoints,
      Width: roundTo(obbW, 2),
      Depth: roundTo(obbD, 2),
      Type: "low_obstacle",
      OrientedBbox: corners,
      RotationDeg: roundTo((angle * 180.0) / Math.PI, 1),
    });
  }

  lowObstacles.sort((a, b) => b.PointCount - a.PointCount);
  return lowObstacles;
}

/**
 * Mirrors RplidarScanService.MergeSplitLowObstacles. Merge low-profile
 * obstacle clusters that are likely the same object split by scanner shadow.
 * Two clusters merge when they have similar rotation angle and similar
 * elevation - indicating the same diagonal object split by the overhead
 * structure's shadow.
 */
function mergeSplitLowObstacles(lowObstacles: ObstacleCluster[]): ObstacleCluster[] {
  if (lowObstacles.length < 2) return lowObstacles;

  const maxAngleDiff = 15; // degrees - same object should have similar angle.
  const maxElevDiff = 0.1; // meters - similar elevation.
  const maxCenterDist = 12; // meters - sanity check, don't merge distant clusters.

  const merged = [...lowObstacles];
  let didMerge: boolean;

  do {
    didMerge = false;
    for (let i = 0; i < merged.length && !didMerge; i++) {
      for (let j = i + 1; j < merged.length && !didMerge; j++) {
        const a = merged[i];
        const b = merged[j];

        if (Math.abs(a.AvgHeight - b.AvgHeight) > maxElevDiff) continue;

        let angleDiff = Math.abs(a.RotationDeg - b.RotationDeg);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;
        if (angleDiff > maxAngleDiff) continue;

        const dist = Math.sqrt((a.CenterX - b.CenterX) ** 2 + (a.CenterY - b.CenterY) ** 2);
        if (dist > maxCenterDist) continue;

        const allCorners: number[][] = [];
        if (a.OrientedBbox) allCorners.push(...a.OrientedBbox);
        else
          allCorners.push(
            [a.MinX, a.MinY],
            [a.MaxX, a.MinY],
            [a.MaxX, a.MaxY],
            [a.MinX, a.MaxY],
          );
        if (b.OrientedBbox) allCorners.push(...b.OrientedBbox);
        else
          allCorners.push(
            [b.MinX, b.MinY],
            [b.MaxX, b.MinY],
            [b.MaxX, b.MaxY],
            [b.MinX, b.MaxY],
          );

        const mx = allCorners.reduce((sum, c) => sum + c[0], 0) / allCorners.length;
        const my = allCorners.reduce((sum, c) => sum + c[1], 0) / allCorners.length;
        let cvxx = 0;
        let cvxy = 0;
        let cvyy = 0;
        for (const c of allCorners) {
          const ddx = c[0] - mx;
          const ddy = c[1] - my;
          cvxx += ddx * ddx;
          cvxy += ddx * ddy;
          cvyy += ddy * ddy;
        }
        const ang = 0.5 * Math.atan2(2 * cvxy, cvxx - cvyy);
        const ca = Math.cos(-ang);
        const sa = Math.sin(-ang);
        let rxMin = Number.POSITIVE_INFINITY;
        let rxMax = Number.NEGATIVE_INFINITY;
        let ryMin = Number.POSITIVE_INFINITY;
        let ryMax = Number.NEGATIVE_INFINITY;
        for (const c of allCorners) {
          const ddx = c[0] - mx;
          const ddy = c[1] - my;
          const rx = ddx * ca - ddy * sa;
          const ry = ddx * sa + ddy * ca;
          if (rx < rxMin) rxMin = rx;
          if (rx > rxMax) rxMax = rx;
          if (ry < ryMin) ryMin = ry;
          if (ry > ryMax) ryMax = ry;
        }
        const cb = Math.cos(ang);
        const sb = Math.sin(ang);
        const rc: [number, number][] = [
          [rxMin, ryMin],
          [rxMax, ryMin],
          [rxMax, ryMax],
          [rxMin, ryMax],
        ];
        const newCorners: number[][] = rc.map(([rx, ry]) => [
          roundTo(rx * cb - ry * sb + mx, 2),
          roundTo(rx * sb + ry * cb + my, 2),
        ]);

        const m: ObstacleCluster = {
          Id: a.Id,
          CenterX: roundTo(mx, 2),
          CenterY: roundTo(my, 2),
          MinX: roundTo(Math.min(...newCorners.map((c) => c[0])), 2),
          MaxX: roundTo(Math.max(...newCorners.map((c) => c[0])), 2),
          MinY: roundTo(Math.min(...newCorners.map((c) => c[1])), 2),
          MaxY: roundTo(Math.max(...newCorners.map((c) => c[1])), 2),
          PointCount: a.PointCount + b.PointCount,
          AvgHeight: roundTo((a.AvgHeight * a.PointCount + b.AvgHeight * b.PointCount) / (a.PointCount + b.PointCount), 2),
          MaxHeight: Math.max(a.MaxHeight, b.MaxHeight),
          Width: roundTo(rxMax - rxMin, 2),
          Depth: roundTo(ryMax - ryMin, 2),
          Type: "low_obstacle",
          OrientedBbox: newCorners,
          RotationDeg: roundTo((ang * 180.0) / Math.PI, 1),
        };

        merged[i] = m;
        merged.splice(j, 1);
        didMerge = true;
      }
    }
  } while (didMerge);

  return merged;
}

/** Mirrors RplidarScanService.PointInQuad - standard convex-polygon point test via edge cross products. */
function pointInQuad(px: number, py: number, corners: number[][]): boolean {
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const ex = corners[j][0] - corners[i][0];
    const ey = corners[j][1] - corners[i][1];
    const tx = px - corners[i][0];
    const ty = py - corners[i][1];
    if (ex * ty - ey * tx < 0) return false;
  }
  return true;
}

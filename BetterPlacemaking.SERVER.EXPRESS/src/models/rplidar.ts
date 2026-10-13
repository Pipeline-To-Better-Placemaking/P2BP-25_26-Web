/**
 * Ported from BetterPlacemaking.SERVER/Controllers/RplidarController.cs and
 * Services/Rplidar/RplidarScanService.cs.
 *
 * Rplidar scans are NOT a database resource - they are raw RPLidar `.xyz` point
 * cloud files (one "x y z" point per line, in meters, relative to the sensor's
 * ceiling mount) sitting on disk under RPLIDAR_SCAN_DIRECTORY (presumably
 * uploaded from a Jetson edge device), the same filesystem-artifact pattern
 * models/tracking.ts + services/trackingService.ts use for the CV tracking
 * pipeline's CSV/JSON output. This file only carries plain data shapes/DTOs -
 * the parse/classify/cluster logic lives in services/rplidarService.ts.
 */

/** Mirrors System.Numerics.Vector2 as used for 2D (X,Y) floor/ceiling/wall points. */
export interface Point2 {
  X: number;
  Y: number;
}

/** Mirrors System.Numerics.Vector3 as used for 3D (X,Y,Z) obstacle-band points. */
export interface Point3 {
  X: number;
  Y: number;
  Z: number;
}

/**
 * Mirrors RplidarScanService.cs's ObstacleCluster DTO. `Type` is "obstacle" for
 * standard grid-clustered obstacles (pass 1) and "low_obstacle" for low-profile
 * objects detected in the floor plane via the peak/neighborhood-elevation pass
 * (pass 2) - the latter carries an oriented (rotated) bounding box instead of an
 * axis-aligned one.
 */
export interface ObstacleCluster {
  Id: number;
  CenterX: number;
  CenterY: number;
  MinX: number;
  MaxX: number;
  MinY: number;
  MaxY: number;
  AvgHeight: number;
  MaxHeight: number;
  PointCount: number;
  Width: number;
  Depth: number;
  Type: "obstacle" | "low_obstacle";
  /** For rotated (low-profile) obstacles: 4 corners of the oriented bounding box, each an [x, y] pair. Undefined for axis-aligned "obstacle"-type clusters (mirrors the C# `double[][]?` being null). */
  OrientedBbox?: number[][];
  /** Rotation angle in degrees (0 = axis-aligned). */
  RotationDeg: number;
}

/** Mirrors RplidarScanService.cs's ScanMeta DTO. */
export interface ScanMeta {
  TotalPoints: number;
  /** Average Z of classified floor points (meters, sensor-relative - typically negative since the sensor is ceiling-mounted). */
  FloorZ: number;
  /** Math.Abs(FloorZ) - named "ceiling height" because avgFloorZ is negative (distance below the sensor), not derived from CeilingThreshold. Ported verbatim, naming and all. */
  CeilingHeight: number;
  /** Furthest horizontal (XY-plane) distance from the sensor origin seen in the raw scan. */
  ScanRadius: number;
  FloorThreshold: number;
  CeilingThreshold: number;
}

/** Mirrors RplidarScanService.cs's RplidarScanResult DTO - the full classified-and-clustered scan. */
export interface RplidarScanResult {
  Floor: Point2[];
  /** All points in the obstacle Z-band (for context rendering) - a superset of ClusterPoints. */
  Obstacles: Point3[];
  /** Only points belonging to a valid cluster (for highlighting) - subset of Obstacles plus low-profile-obstacle floor points. */
  ClusterPoints: Point3[];
  Ceiling: Point2[];
  /** Points near the floor boundary, at any Z height (full room outline). */
  WallPoints: Point2[];
  Clusters: ObstacleCluster[];
  Meta: ScanMeta;
}

/** Response shape of GET /api/rplidar/scans - mirrors RplidarController.ListScans's anonymous-object list. */
export interface ScanFileInfo {
  filename: string;
  sizeBytes: number;
  /** ISO-8601 string - mirrors FileInfo.LastWriteTimeUtc being serialized as-is by System.Text.Json. */
  modified: string;
}

/**
 * Mirrors Models/Visualizer/LidarPoint3D.cs - the in-memory point shape the (not
 * yet ported) VisualizerController session holds, consumed by
 * RplidarScanService.ParseFromPointCloud (X/Y/Z in centimeters, converted to
 * meters before classification). Kept here for completeness / future wiring -
 * see rplidar.routes.ts's `from-scan` handler for why it's currently a stub.
 */
export interface LidarPoint3D {
  X: number;
  Y: number;
  Z: number;
  Intensity?: number;
  Classification?: number;
  Color?: string | null;
  Timestamp?: string | null;
  SensorId?: string | null;
}

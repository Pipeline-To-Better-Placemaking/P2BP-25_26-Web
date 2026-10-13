import type { GalleryGeometry, LidarPoint3D } from "../models/visualizer.js";

/**
 * Ported from BetterPlacemaking.SERVER/Services/Visualizer/{GeometryCalculationService,
 * GeometryExportService}.cs. Pure geometry-calculation and export-formatting helpers -
 * no I/O, no database. The export functions here back VisualizerController's
 * `/export/{obj,csv,xyz,xyz-rgb,txt,pts,ply,geometry/json}` endpoints (routes not yet
 * ported - see a later Visualizer routes/controller task).
 *
 * Every exported function below is commented with the C# method it mirrors.
 */

// ─── Formatting helpers ───

/** Mirrors C#'s `{value:F6}` interpolation format (fixed-point, always 6 decimal digits). */
function f6(value: number): string {
  return value.toFixed(6);
}

/**
 * Mirrors GeometryExportService.ParseColorHex (private helper shared by every
 * RGB-emitting exporter below). Returns mid-gray (128, 128, 128) for a
 * missing/malformed hex color, matching the original's null-check and
 * catch-all fallback.
 */
function parseColorHex(colorHex: string | null | undefined): [number, number, number] {
  if (!colorHex || !colorHex.startsWith("#") || colorHex.length < 7) return [128, 128, 128];

  const r = Number.parseInt(colorHex.substring(1, 3), 16);
  const g = Number.parseInt(colorHex.substring(3, 5), 16);
  const b = Number.parseInt(colorHex.substring(5, 7), 16);

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [128, 128, 128];
  return [r, g, b];
}

/** Joins lines with a trailing newline after each one (including the last) - mirrors repeated `StringBuilder.AppendLine` calls. */
function joinLines(lines: string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

// ─── GeometryCalculationService.cs ───

/**
 * Mirrors GeometryCalculationService.CalculateFullGeometry. Computes an
 * axis-aligned bounding box over the point cloud (native units - centimeters,
 * matching LidarPoint3D) and wraps it as a GalleryGeometry: Width is the X
 * extent, Height is the Z extent (vertical), Depth is the Y extent - the same
 * axis mapping ExportPointCloudToObj below uses (Y is depth, Z is height).
 * Returns a zeroed "Empty Room" for an empty point list.
 */
export function calculateFullGeometry(points: LidarPoint3D[]): GalleryGeometry {
  if (points.length === 0) {
    return { Name: "Empty Room", Width: 0, Height: 0, Depth: 0, Walls: [], Objects: [] };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const p of points) {
    if (p.X < minX) minX = p.X;
    if (p.X > maxX) maxX = p.X;
    if (p.Y < minY) minY = p.Y;
    if (p.Y > maxY) maxY = p.Y;
    if (p.Z < minZ) minZ = p.Z;
    if (p.Z > maxZ) maxZ = p.Z;
  }

  return {
    Name: "Calculated Room",
    Width: maxX - minX,
    Height: maxZ - minZ,
    Depth: maxY - minY,
    Walls: [],
    Objects: [],
  };
}

// ─── GeometryExportService.cs ───

/** Mirrors GeometryExportService.ExportRoomGeometryToObj - a minimal comment-only OBJ header (the original never emits actual room wall/object geometry here). */
export function exportRoomGeometryToObj(geometry: GalleryGeometry): string {
  return joinLines([
    "# Room Geometry OBJ Export",
    `# Width: ${geometry.Width}, Height: ${geometry.Height}, Depth: ${geometry.Depth}`,
  ]);
}

/** Mirrors GeometryExportService.ExportPointCloudToObj. Note the axis swap: each vertex is emitted as `v X Z Y` (not X Y Z), matching the original exactly. Coordinates are left in their native units (centimeters), unconverted. */
export function exportPointCloudToObj(points: LidarPoint3D[]): string {
  const lines = ["# Point Cloud OBJ Export"];
  for (const p of points) lines.push(`v ${p.X} ${p.Z} ${p.Y}`);
  return joinLines(lines);
}

/** Mirrors GeometryExportService.ExportToCsv. Coordinates are left in their native units (centimeters), unconverted. */
export function exportToCsv(points: LidarPoint3D[]): string {
  const lines = ["X,Y,Z,Intensity,Classification,Color"];
  for (const p of points) {
    lines.push(`${p.X},${p.Y},${p.Z},${p.Intensity},${p.Classification},${p.Color ?? ""}`);
  }
  return joinLines(lines);
}

/**
 * Mirrors GeometryExportService.ExportToXyz. Exports space-separated `x y z`
 * (no header) for Rhino import; coordinates are converted from centimeters to
 * meters and formatted to 6 fixed decimal places.
 */
export function exportToXyz(points: LidarPoint3D[]): string {
  const lines = points.map((p) => `${f6(p.X / 100.0)} ${f6(p.Y / 100.0)} ${f6(p.Z / 100.0)}`);
  return joinLines(lines);
}

/** Mirrors GeometryExportService.ExportToXyzRgb - like ExportToXyz, with an appended `r g b` (0-255) parsed from each point's Color hex. */
export function exportToXyzRgb(points: LidarPoint3D[]): string {
  const lines = points.map((p) => {
    const [r, g, b] = parseColorHex(p.Color);
    return `${f6(p.X / 100.0)} ${f6(p.Y / 100.0)} ${f6(p.Z / 100.0)} ${r} ${g} ${b}`;
  });
  return joinLines(lines);
}

/** Mirrors GeometryExportService.ExportToTxt - comma-separated `x,y,z` (meters, 6 fixed decimals) for Rhino import. */
export function exportToTxt(points: LidarPoint3D[]): string {
  const lines = points.map((p) => `${f6(p.X / 100.0)},${f6(p.Y / 100.0)},${f6(p.Z / 100.0)}`);
  return joinLines(lines);
}

/**
 * Mirrors GeometryExportService.ExportToPts - Leica PTS format (supported by
 * Rhino): a point-count header line, then per point `x y z intensity r g b`
 * (meters; intensity is `Intensity * 255` truncated toward zero, matching C#'s
 * `(int)` cast).
 */
export function exportToPts(points: LidarPoint3D[]): string {
  const lines = [String(points.length)];
  for (const p of points) {
    const [r, g, b] = parseColorHex(p.Color);
    const intensity = Math.trunc(p.Intensity * 255);
    lines.push(`${f6(p.X / 100.0)} ${f6(p.Y / 100.0)} ${f6(p.Z / 100.0)} ${intensity} ${r} ${g} ${b}`);
  }
  return joinLines(lines);
}

/** Mirrors GeometryExportService.ExportToPly - ASCII PLY with a fixed x/y/z + red/green/blue header, then per-point `x y z r g b` (meters). */
export function exportToPly(points: LidarPoint3D[]): string {
  const lines = [
    "ply",
    "format ascii 1.0",
    `element vertex ${points.length}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "end_header",
  ];
  for (const p of points) {
    const [r, g, b] = parseColorHex(p.Color);
    lines.push(`${f6(p.X / 100.0)} ${f6(p.Y / 100.0)} ${f6(p.Z / 100.0)} ${r} ${g} ${b}`);
  }
  return joinLines(lines);
}

/** Mirrors GeometryExportService.ExportGeometryToJson - indented (2-space) JSON, PascalCase field names as declared on GalleryGeometry (matches System.Text.Json's default of serializing exact C# property names, no naming-policy conversion configured on the original). */
export function exportGeometryToJson(geometry: GalleryGeometry): string {
  return JSON.stringify(geometry, null, 2);
}

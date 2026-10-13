import { getWorkstation } from "../workstation/index.js";
import type { LidarPoint, LidarPoint3D, Point3D } from "../models/visualizer.js";

/**
 * Ported from BetterPlacemaking.SERVER/Services/Visualizer/{ObjParserService,
 * PlyParserService, XyzParserService, PointCloudService}.cs. Parses raw OBJ/PLY/XYZ
 * point-cloud/mesh file content into the shared shapes from models/visualizer.ts.
 *
 * File-reading strategy: the C# services read from a `Stream` (OBJ/PLY) or a file
 * path on disk (XYZ). OBJ/PLY here instead take the file's text content directly as
 * a `string` - callers (route handlers, storage downloads, etc.) are expected to read
 * the uploaded/stored file into a string first, which is more natural for an
 * Express handler than plumbing a Node stream through. XYZ keeps its original
 * disk-file-path signature since XyzParserService.cs always reads from a known
 * scan-directory path (see rplidarService.ts's analogous file-path convention),
 * not from an upload.
 *
 * Every exported/internal function below is commented with the C# method it
 * mirrors. Parsing is preserved faithfully, quirks included (see per-function
 * notes) since malformed parsing would silently corrupt geometry data.
 */

// ─── Shared numeric-parsing helpers ───

/**
 * Strict double parse used where the C# original uses `double.Parse` (which
 * throws System.FormatException on bad input, uncaught by the caller). Returns
 * NaN check as a thrown Error instead, preserving the "the whole operation fails"
 * behavior for OBJ vertex/face parsing.
 */
function parseDoubleStrict(token: string): number {
  const trimmed = token.trim();
  const value = Number(trimmed);
  if (trimmed.length === 0 || !Number.isFinite(value)) {
    throw new Error(`Input string was not in a correct format: "${token}"`);
  }
  return value;
}

/** Strict integer parse mirroring `int.Parse`'s throw-on-bad-input behavior (used for OBJ face indices). */
function parseIntStrict(token: string): number {
  const trimmed = token.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    throw new Error(`Input string was not in a correct format: "${token}"`);
  }
  return Number.parseInt(trimmed, 10);
}

/** Non-throwing double parse mirroring `double.TryParse` (used wherever the C# original skips the row/line on failure instead of throwing). */
function tryParseDouble(token: string | undefined): number | null {
  if (token === undefined) return null;
  const trimmed = token.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Non-throwing integer parse mirroring `int.TryParse` (strict digits only - unlike `Number()`, rejects e.g. "1.0"). */
function tryParseInt(token: string | undefined): number | null {
  if (token === undefined) return null;
  const trimmed = token.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

/** Uppercase, zero-padded (min 2 digits) hex - mirrors C#'s `{value:X2}` interpolation format. */
function toHex2(value: number): string {
  const hex = Math.trunc(value).toString(16).toUpperCase();
  return hex.length < 2 ? hex.padStart(2, "0") : hex;
}

/** Splits a line on the single-space delimiter with empty entries removed - mirrors `line.Split(' ', StringSplitOptions.RemoveEmptyEntries)` (used by OBJ and PLY; NOT a general-whitespace split, so tabs are not treated as delimiters here). */
function splitOnSpace(line: string): string[] {
  return line.split(" ").filter((s) => s.length > 0);
}

/** Splits raw file text into lines the way `StreamReader.ReadLine()` / `File.ReadAllLines` do - handles \r\n, \r, and \n, with no trailing empty entry for a file ending in a newline. */
function splitLines(content: string): string[] {
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// ─── ObjParserService.cs ───

/** Mirrors ObjParserService.cs's local `ObjMeshData` class (declared in the service file itself, not under Models/Visualizer). */
export interface ObjMeshData {
  Vertices: Point3D[];
  Faces: number[][];
  Normals: Point3D[];
}

/**
 * Mirrors ObjParserService.ParseObjFile. Only "v" (vertex) and "f" (face) lines
 * are handled, matching the original - no vt/vn/g/o/mtllib/usemtl handling, and
 * `Normals` is always returned empty (the original never populates it despite it
 * being part of ObjMeshData). Face vertex indices are converted from OBJ's
 * 1-based to 0-based on output; only the vertex-index component of each `f`
 * token is kept (a `v/vt/vn` texture/normal-index suffix, if present, is
 * discarded - same as the original). Blank lines and lines starting with "#" are
 * skipped. Throws if a numeric token fails to parse, mirroring the original's
 * unhandled `double.Parse`/`int.Parse` FormatException (no try/catch there).
 */
export function parseObjFile(content: string): ObjMeshData {
  const meshData: ObjMeshData = { Vertices: [], Faces: [], Normals: [] };

  for (const rawLine of splitLines(content)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const parts = splitOnSpace(line);
    if (parts.length === 0) continue;

    switch (parts[0]) {
      case "v":
        if (parts.length >= 4) {
          meshData.Vertices.push({
            X: parseDoubleStrict(parts[1]),
            Y: parseDoubleStrict(parts[2]),
            Z: parseDoubleStrict(parts[3]),
          });
        }
        break;
      case "f":
        if (parts.length >= 4) {
          const face: number[] = [];
          for (let i = 1; i < parts.length; i++) {
            const vertexIndexToken = parts[i].split("/")[0];
            face.push(parseIntStrict(vertexIndexToken) - 1);
          }
          meshData.Faces.push(face);
        }
        break;
    }
  }

  return meshData;
}

/** Mirrors ObjParserService.ExtractPointCloudFromObj. */
export function extractPointCloudFromObj(content: string): LidarPoint3D[] {
  const meshData = parseObjFile(content);
  return meshData.Vertices.map((v) => ({
    X: v.X,
    Y: v.Y,
    Z: v.Z,
    Intensity: 0.8,
    Classification: 0,
  }));
}

// ─── PlyParserService.cs ───

/**
 * Mirrors PlyParserService.ParsePlyStream. Parses ASCII PLY (Polygon File
 * Format) content into LidarPoint3D points; coordinates are converted from
 * meters (typical for Stanford-style datasets, this format's usual source) to
 * centimeters. Supports vertex properties x, y, z and optional r/g/b or
 * red/green/blue (checked in that fallback order).
 *
 * Faithfully preserved quirks from the original:
 *  - EVERY "property" header line (not just ones following "element vertex")
 *    is appended to a single flat `properties` list used for column indices -
 *    a PLY file with additional elements (e.g. "element face" + its
 *    "property list ..." line) will pollute this list exactly as it does in
 *    the C# source (no handling of the `list` property flavor).
 *  - A blank line within the vertex data block still consumes one
 *    `lineIndex` (counted against `vertexCount`) without producing a point.
 *  - `maxPoints` (default 0 = unlimited) downsamples via a fixed step
 *    (`ceil(vertexCount / maxPoints)`), keeping every `step`-th line by index.
 *  - If x/y/z properties aren't found, or the header never sets a non-zero
 *    vertex count, an empty list is returned rather than throwing.
 */
export function parsePlyStream(content: string, sensorId?: string | null, maxPoints = 0): LidarPoint3D[] {
  const points: LidarPoint3D[] = [];
  const lines = content.split(/\r\n|\r|\n/);
  let cursor = 0;

  // ── Parse header ──
  let vertexCount = 0;
  const properties: string[] = [];
  let inHeader = true;

  while (inHeader && cursor < lines.length) {
    const line = (lines[cursor] ?? "").trim();
    cursor++;
    if (line.length === 0) continue;

    if (line.startsWith("element vertex")) {
      const parts = splitOnSpace(line);
      if (parts.length >= 3) {
        const vc = tryParseInt(parts[2]);
        if (vc !== null) vertexCount = vc;
      }
    } else if (line.startsWith("property")) {
      // e.g. "property float x" or "property uchar red"
      const parts = splitOnSpace(line);
      if (parts.length >= 3) properties.push(parts[2].toLowerCase());
    } else if (line === "end_header") {
      inHeader = false;
    }
  }

  if (vertexCount === 0) return points;

  // Determine column indices.
  const xIdx = properties.indexOf("x");
  const yIdx = properties.indexOf("y");
  const zIdx = properties.indexOf("z");
  let rIdx = properties.indexOf("red");
  let gIdx = properties.indexOf("green");
  let bIdx = properties.indexOf("blue");

  // Some PLY files use "r", "g", "b" instead of "red", "green", "blue".
  if (rIdx < 0) rIdx = properties.indexOf("r");
  if (gIdx < 0) gIdx = properties.indexOf("g");
  if (bIdx < 0) bIdx = properties.indexOf("b");

  const hasColor = rIdx >= 0 && gIdx >= 0 && bIdx >= 0;

  if (xIdx < 0 || yIdx < 0 || zIdx < 0) return points; // Can't parse without x, y, z

  // Determine downsample step if maxPoints is set.
  let step = 1;
  if (maxPoints > 0 && vertexCount > maxPoints) {
    step = Math.ceil(vertexCount / maxPoints);
  }

  // ── Parse vertices ──
  let lineIndex = 0;
  while (cursor < lines.length && lineIndex < vertexCount) {
    const line = lines[cursor];
    cursor++;

    if (line === undefined || line.trim().length === 0) {
      lineIndex++;
      continue;
    }

    // Downsample: skip lines not on step boundary.
    if (lineIndex % step !== 0) {
      lineIndex++;
      continue;
    }

    const parts = splitOnSpace(line);
    if (parts.length < properties.length) {
      lineIndex++;
      continue;
    }

    const x = tryParseDouble(parts[xIdx]);
    const y = tryParseDouble(parts[yIdx]);
    const z = tryParseDouble(parts[zIdx]);
    if (x === null || y === null || z === null) {
      lineIndex++;
      continue;
    }

    let color: string | null = null;
    if (hasColor) {
      const r = tryParseInt(parts[rIdx]);
      const g = tryParseInt(parts[gIdx]);
      const b = tryParseInt(parts[bIdx]);
      if (r !== null && g !== null && b !== null) {
        color = `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
      }
    }

    // Convert from meters to centimeters (standard for this app).
    points.push({
      X: x * 100.0,
      Y: y * 100.0,
      Z: z * 100.0,
      Color: color,
      Intensity: 1.0,
      Classification: 0,
      SensorId: sensorId ?? null,
    });

    lineIndex++;
  }

  return points;
}

// ─── XyzParserService.cs ───

const MILLIMETERS_TO_CENTIMETERS = 0.1;
const METERS_TO_CENTIMETERS = 100.0;

function unitsToCmFactor(units: string): number {
  return units.toLowerCase() === "m" ? METERS_TO_CENTIMETERS : MILLIMETERS_TO_CENTIMETERS;
}

/**
 * Mirrors XyzParserService.ParseXyzFile. Reads a `.xyz` file from disk: each
 * line is `x y z`, `x y z intensity`, or `x y z r g b` (space/tab-separated,
 * `StringSplitOptions.RemoveEmptyEntries`-equivalent). `units` is "mm" (default)
 * or "m" (case-insensitive) for meter-based exports (typical RPLidar); output
 * X/Y/Z are always centimeters. Throws if the file does not exist, mirroring the
 * original's `FileNotFoundException`. A line whose numeric tokens fail to parse
 * is skipped entirely (mirrors the original's `catch (FormatException) continue`
 * wrapping the whole per-line parse block, not just individual fields).
 */
export async function parseXyzFile(filePath: string, sensorId?: string | null, units = "mm"): Promise<LidarPoint3D[]> {
  const ws = getWorkstation();
  if (!(await ws.exists(filePath))) {
    throw new Error(`XYZ file not found: ${filePath}`);
  }

  const factor = unitsToCmFactor(units);
  const points: LidarPoint3D[] = [];
  const content = await ws.readText(filePath);
  const lines = splitLines(content);
  const scanTimestamp = new Date();

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();
    if (trimmedLine.length === 0) continue;

    const parts = trimmedLine.split(/[ \t]+/).filter((s) => s.length > 0);
    if (parts.length < 3) continue;

    const x = tryParseDouble(parts[0]);
    const y = tryParseDouble(parts[1]);
    const z = tryParseDouble(parts[2]);
    if (x === null || y === null || z === null) continue;

    let r = 150;
    let g = 150;
    let b = 150;
    let rowValid = true;

    if (parts.length >= 6) {
      const rr = tryParseInt(parts[3]);
      const gg = tryParseInt(parts[4]);
      const bb = tryParseInt(parts[5]);
      if (rr === null || gg === null || bb === null) {
        rowValid = false;
      } else {
        r = rr;
        g = gg;
        b = bb;
      }
    } else if (parts.length >= 4) {
      const intensity = tryParseInt(parts[3]);
      if (intensity === null) {
        rowValid = false;
      } else {
        r = g = b = intensity;
      }
    }

    if (!rowValid) continue;

    const pointIntensity = (r + g + b) / 3.0 / 255.0;
    const color = `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;

    points.push({
      X: x * factor,
      Y: y * factor,
      Z: z * factor,
      Intensity: pointIntensity,
      Classification: 0,
      Color: color,
      Timestamp: scanTimestamp,
      SensorId: sensorId ?? "rplidar",
    });
  }

  return points;
}

/** Mirrors XyzParserService.ParseXyzFiles - parse and merge two .xyz files (filePathB is optional). */
export async function parseXyzFiles(
  filePathA: string,
  filePathB?: string | null,
  sensorId?: string | null,
  units = "mm",
): Promise<LidarPoint3D[]> {
  const ws = getWorkstation();
  const points: LidarPoint3D[] = [];

  if (await ws.exists(filePathA)) {
    points.push(...(await parseXyzFile(filePathA, sensorId, units)));
  }

  if (filePathB && (await ws.exists(filePathB))) {
    points.push(...(await parseXyzFile(filePathB, sensorId, units)));
  }

  return points;
}

/** Mirrors XyzParserService.ConvertToLidarPoint3D. Note: always uses the mm->cm factor regardless of any file "units" context (matches the original, which has no `units` parameter here). */
export function convertToLidarPoint3D(
  x: number,
  y: number,
  z: number,
  r = 150,
  g = 150,
  b = 150,
  sensorId?: string | null,
): LidarPoint3D {
  const cx = x * MILLIMETERS_TO_CENTIMETERS;
  const cy = y * MILLIMETERS_TO_CENTIMETERS;
  const cz = z * MILLIMETERS_TO_CENTIMETERS;

  const pointIntensity = (r + g + b) / 3.0 / 255.0;
  const color = `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;

  return {
    X: cx,
    Y: cy,
    Z: cz,
    Intensity: pointIntensity,
    Classification: 0,
    Color: color,
    Timestamp: new Date(),
    SensorId: sensorId ?? "rplidar",
  };
}

// ─── PointCloudService.cs ───

/** Mirrors PointCloudService.Convert2DTo3D. */
export function convert2DTo3D(points2D: LidarPoint[], defaultZ: number): LidarPoint3D[] {
  return points2D.map((p) => ({
    X: p.X,
    Y: p.Y,
    Z: defaultZ,
    Intensity: 0.8,
    Classification: 0,
  }));
}

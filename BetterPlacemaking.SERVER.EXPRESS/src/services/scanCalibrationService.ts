import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { scanCalibrationRecords } from "../db/schema/index.js";
import { getWorkstation } from "../workstation/index.js";
import * as scanDeviceService from "./scanDeviceService.js";
import type {
  CombineCloudInput,
  CombinedScanResult,
  CombineScansRequest,
  PreviewPoint,
  XyzPoint,
} from "../models/scanCalibration.js";

/**
 * Ported from BetterPlacemaking.SERVER/Controllers/ScanCalibrationController.cs and
 * BetterPlacemaking.SERVER/Services/ScanCombine/{CombineCloudsService,
 * ScanFlattenPreviewService}.cs.
 *
 * IMPORTANT - error-status mapping is NOT what it looks like: every function below
 * that can fail (resolveLocalXyzPath, combineClouds, buildPreviewPoints) throws plain
 * Error/ScanCalibration*Error instances, and scanCalibration.routes.ts maps ALL of them
 * to HTTP 500, never 404/400. This mirrors the old controller exactly: every action
 * method wraps its whole body in `try { ... } catch (Exception ex) { return
 * Problem(ex.Message); }`, and ASP.NET's `Problem(string)` defaults to a 500 response.
 * So "scan not found" / "no ObjUrl" / "XYZ file not found" - things that would
 * intuitively be 404s - are actually 500s on the old server. Only the handful of
 * explicit `BadRequest(...)`/`NotFound(...)` calls literally written in
 * ScanCalibrationController's method bodies (not exceptions) produce 400/404; those are
 * reproduced as plain `res.status(...)` checks directly in the route handlers, not via
 * these thrown error classes. This is flagged here and in scanCalibration.routes.ts
 * because it's surprising, not because it's obviously correct - it's ported faithfully
 * either way.
 */

/** Thrown for conditions the old server reported via a thrown FileNotFoundException. */
export class ScanCalibrationNotFoundError extends Error {}

/** Thrown for conditions the old server reported via a thrown ArgumentException/InvalidOperationException. */
export class ScanCalibrationValidationError extends Error {}

/**
 * Mirrors Convert.ToDouble(s, CultureInfo.InvariantCulture) for the plain decimal
 * literals a .xyz file contains (e.g. "1.23", "-0.5", "1.2e-3"). Throws on anything
 * unparseable, matching the FormatException the old server would let propagate up
 * through ReadXyz/RenderPreviewPng to the controller's catch-all.
 */
function parseInvariantDouble(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Input string '${raw}' was not in a correct format.`);
  }
  return value;
}

/**
 * Splits a line the same way CombineCloudsService.ReadXyz / ScanFlattenPreviewService
 * do: `line.Split(' ', StringSplitOptions.RemoveEmptyEntries)` - space-delimited only
 * (not any-whitespace), empty tokens dropped.
 */
function splitXyzLine(line: string): string[] {
  return line.split(" ").filter((s) => s.length > 0);
}

/**
 * Mirrors CombineCloudsService.ReadXyz's private parsing loop (the file-existence
 * check + line reading live in readXyz below; this is just the per-line parse).
 */
function parseXyzPoints(raw: string): XyzPoint[] {
  const points: XyzPoint[] = [];
  for (const line of raw.split(/\r\n|\r|\n/)) {
    if (!line.trim()) continue;

    const parts = splitXyzLine(line);
    if (parts.length < 3) continue;

    points.push({
      X: parseInvariantDouble(parts[0]),
      Y: parseInvariantDouble(parts[1]),
      Z: parseInvariantDouble(parts[2]),
    });
  }
  return points;
}

/** Mirrors CombineCloudsService.ReadXyz (file-existence check + read + parse). */
async function readXyz(filePath: string): Promise<XyzPoint[]> {
  const ws = getWorkstation();
  if (!(await ws.exists(filePath))) {
    throw new ScanCalibrationNotFoundError(`XYZ file not found: ${filePath}`);
  }
  const raw = await ws.readText(filePath);
  return parseXyzPoints(raw);
}

/**
 * Mirrors CombineCloudsService.Manipulate EXACTLY:
 *
 *   var thetaRad = theta * Math.PI / 180.0;
 *   foreach (var n in points) {
 *       var r = n.Distance();                          // sqrt(x^2 + y^2)
 *       var polarTheta = Math.Atan2(n.Y, n.X);          // "Safer than atan(y/x)"
 *       var newTheta = polarTheta + thetaRad;
 *       n.X = r * Math.Cos(newTheta);
 *       n.Y = r * Math.Sin(newTheta);
 *       n.X += xTranslation;
 *       n.Y += yTranslation;
 *   }
 *
 * i.e. convert to polar (r, theta) about the origin, add the rotation, convert back
 * to Cartesian, then translate. Z is untouched. Mutates the input points in place and
 * returns them, same as the source. Trig-function results (Math.Cos/Sin/Atan2) are not
 * guaranteed bit-identical between the .NET CLR and Node/V8 for irrational results -
 * this is a cross-runtime limitation of any such port, not a translation error; the
 * *formula* below is character-for-character equivalent to the source.
 */
export function manipulatePoints(points: XyzPoint[], xTranslation: number, yTranslation: number, theta: number): XyzPoint[] {
  const thetaRad = (theta * Math.PI) / 180.0;

  for (const n of points) {
    const r = Math.sqrt(n.X * n.X + n.Y * n.Y);

    const polarTheta = Math.atan2(n.Y, n.X);
    const newTheta = polarTheta + thetaRad;

    n.X = r * Math.cos(newTheta);
    n.Y = r * Math.sin(newTheta);

    n.X += xTranslation;
    n.Y += yTranslation;
  }

  return points;
}

/** Mirrors DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss") - local server time, zero-padded. */
function formatLocalTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/**
 * Mirrors CombineCloudsService.CombineClouds: reads each input's .xyz file, applies its
 * translation/rotation via manipulatePoints, and concatenates all transformed points
 * (in input order) into one new .xyz file written under outputDirectory. Throws the
 * same ArgumentException-equivalent as the source if fewer than two inputs are given
 * (the route also checks this first, same as the old controller does before calling
 * the service - this is a redundant defense-in-depth check here too, not new logic).
 */
export async function combineClouds(inputs: CombineCloudInput[], outputDirectory: string, outputName: string | null | undefined): Promise<CombinedScanResult> {
  if (!inputs || inputs.length < 2) {
    throw new ScanCalibrationValidationError("At least two scans are required to combine point clouds.");
  }

  const ws = getWorkstation();
  await ws.ensureDir(outputDirectory);

  const safeBaseName = !outputName || !outputName.trim() ? "calibrationScan" : outputName.trim();
  const fileName = `${safeBaseName}_${formatLocalTimestamp(new Date())}.xyz`;
  const outputPath = path.join(outputDirectory, fileName);

  const lines: string[] = [];
  for (const cloud of inputs) {
    const points = await readXyz(cloud.XyzFilePath);
    const transformed = manipulatePoints(points, cloud.XTranslation, cloud.YTranslation, cloud.Theta);

    for (const p of transformed) {
      // StreamWriter.WriteLine(...) - double.ToString(InvariantCulture) with no format
      // string uses .NET's shortest-round-trippable representation, which for ordinary
      // finite values matches JS's own default Number->string conversion (also
      // shortest-round-trippable, '.' decimal point, no thousands separators).
      //
      // ONE KNOWN COSMETIC DIFFERENCE: for values that render in exponential notation,
      // .NET emits a capital 'E' ("6.123233995736766E-17") and JS a lowercase 'e'
      // ("6.123233995736766e-17"). Both runtimes parse either spelling, and readXyz below
      // round-trips both, so nothing in this pipeline is affected - but a third-party
      // consumer of these .xyz files that parses strictly could notice.
      //
      // Note this is NOT a rare edge case: manipulatePoints' polar round-trip produces
      // values like cos(pi/2) = 6.12e-17 whenever a point lands on an axis, which happens
      // routinely - including at theta = 0. See the regression tests in
      // scanCalibration.routes.test.ts.
      lines.push(`${p.X} ${p.Y} ${p.Z}`);
    }
  }

  // Every source line ends with WriteLine, including the last - trailing newline mirrors that.
  await ws.writeFile(outputPath, lines.length > 0 ? lines.join("\n") + "\n" : "");

  return { OutputFilePath: outputPath, OutputFileName: fileName };
}

/**
 * Mirrors ScanFlattenPreviewService.RenderPreviewPng's point extraction/filtering loop
 * (file-existence check, per-line parse, Z-threshold filter, running max XY distance).
 * The Plotter.Render rasterization step that consumes this is renderPreviewPng below.
 * Throws the same InvalidOperationException-equivalent as the source when no valid
 * point survives filtering.
 */
export async function buildPreviewPoints(xyzFilePath: string, threshold = -2.75, useThreshold = true): Promise<{ points: PreviewPoint[]; maxDistance: number }> {
  const ws = getWorkstation();
  if (!(await ws.exists(xyzFilePath))) {
    throw new ScanCalibrationNotFoundError(`XYZ file not found: ${xyzFilePath}`);
  }
  const raw = await ws.readText(xyzFilePath);

  const points: PreviewPoint[] = [];
  let maxDistance = 0;

  for (const line of raw.split(/\r\n|\r|\n/)) {
    if (!line.trim()) continue;

    const parts = splitXyzLine(line);
    if (parts.length < 3) continue;

    const x = parseInvariantDouble(parts[0]);
    const y = parseInvariantDouble(parts[1]);
    const z = parseInvariantDouble(parts[2]);

    if (useThreshold && z <= threshold) continue;

    const dist = Math.sqrt(x * x + y * y);
    points.push({ x, y });
    if (dist > maxDistance) maxDistance = dist;
  }

  if (points.length === 0 || maxDistance <= 0) {
    throw new ScanCalibrationValidationError("No valid XY points were found to render a preview.");
  }

  return { points, maxDistance };
}

// ===========================================================================
// Plotter.Render port (Services/ScanCombine/Plotter.cs).
//
// The C# original rasterizes with SkiaSharp. Rather than take a native image
// dependency, this hand-rolls the same drawing into an RGBA buffer and encodes
// a PNG with Node's built-in zlib - the same "no native image libraries"
// approach floorplanLibraryService.ts already uses for image headers.
//
// Exactly equivalent: canvas geometry (worldPixels 1280, padding 20 => 1320x1320),
// the scale factor, the y-flipped world->pixel mapping, the transparent
// background, the colors, and the per-point draw ORDER (fill then outline for
// each point in turn, so a later point's fill can overwrite an earlier point's
// outline - matching the C# loop).
//
// DELIBERATE DEVIATION: Skia draws with IsAntialias = true; this rasterizer is
// hard-edged. Circle edges differ by a sub-pixel alpha ramp, so output is NOT
// byte-identical to the C# PNG. This is a debug preview image of a point cloud,
// not a geometric result - no coordinate, scale, or position differs. Flagged
// rather than hidden.
// ===========================================================================

const PREVIEW_WORLD_PIXELS = 1280;
const PREVIEW_PADDING = 20;
const PREVIEW_POINT_RADIUS = 4;

let crcTable: Uint32Array | null = null;

function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encodes an RGBA pixel buffer as a PNG (8-bit, colour type 6, no interlace). */
function encodePng(rgba: Buffer, width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Mirrors Plotter.Render. `maxDistance` must be positive, matching the source's
 * ArgumentOutOfRangeException guard.
 */
export function renderPreviewPng(points: PreviewPoint[], maxDistance: number): Buffer {
  if (!(maxDistance > 0)) {
    throw new ScanCalibrationValidationError("maxDistance must be positive.");
  }

  const scale = PREVIEW_WORLD_PIXELS / (2.0 * maxDistance);
  const canvasSize = PREVIEW_WORLD_PIXELS + PREVIEW_PADDING * 2;
  const cx = canvasSize / 2.0;
  const cy = canvasSize / 2.0;

  // Transparent background (SKColors.Transparent), premultiplied alpha - all-zero.
  const rgba = Buffer.alloc(canvasSize * canvasSize * 4);

  const fillR = 0;
  const fillG = 0;
  const fillB = 255; // SKColors.Blue
  const outline = 255; // SKColors.White, r = g = b

  const r = PREVIEW_POINT_RADIUS;
  // Skia's 1px stroke is centred on the radius-4 path, so it covers 3.5..4.5.
  const strokeInner = r - 0.5;
  const strokeOuter = r + 0.5;
  const reach = Math.ceil(strokeOuter);

  const setPixel = (x: number, y: number, red: number, green: number, blue: number): void => {
    const o = (y * canvasSize + x) * 4;
    rgba[o] = red;
    rgba[o + 1] = green;
    rgba[o + 2] = blue;
    rgba[o + 3] = 255;
  };

  for (const pt of points) {
    // ToPixel: y is flipped, matching `cy - wy * scale` in the source.
    const px = cx + pt.x * scale;
    const py = cy - pt.y * scale;

    const minX = Math.max(0, Math.floor(px - reach));
    const maxX = Math.min(canvasSize - 1, Math.ceil(px + reach));
    const minY = Math.max(0, Math.floor(py - reach));
    const maxY = Math.min(canvasSize - 1, Math.ceil(py + reach));

    // Fill pass, then outline pass - same order as the two DrawCircle calls.
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - px;
        const dy = y + 0.5 - py;
        if (dx * dx + dy * dy <= r * r) setPixel(x, y, fillR, fillG, fillB);
      }
    }
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - px;
        const dy = y + 0.5 - py;
        const d2 = dx * dx + dy * dy;
        if (d2 >= strokeInner * strokeInner && d2 <= strokeOuter * strokeOuter) {
          setPixel(x, y, outline, outline, outline);
        }
      }
    }
  }

  return encodePng(rgba, canvasSize, canvasSize);
}

/** Mirrors ScanFlattenPreviewService.RenderPreviewPng end to end. */
export async function renderPreviewPngFromFile(xyzFilePath: string, threshold = -2.75, useThreshold = true): Promise<Buffer> {
  const { points, maxDistance } = await buildPreviewPoints(xyzFilePath, threshold, useThreshold);
  return renderPreviewPng(points, maxDistance);
}

/**
 * Mirrors ScanCalibrationController.ResolveLocalXyzPath: looks up the scan doc, then
 * resolves its ObjUrl to a local filesystem path - either because it already is one
 * (uploaded/combined calibration files), or by downloading it once from an http(s) URL
 * into a local cache directory (normal device-produced scans, which store a signed
 * URL). Reuses scanDeviceService.getScan (same database path/Scan type - not
 * redefined here) rather than querying database directly a second time, unlike the
 * old controller which talks to the database inline; the read shape is identical either
 * way.
 */
export async function resolveLocalXyzPath(projectId: string, deviceId: string, scanId: string): Promise<string> {
  // Calibration scans (uploaded/combined) live in scan_calibration_records; ordinary device
  // scans still resolve through scanDeviceService.
  const record = await getCalibrationRecord(projectId, deviceId, scanId);
  const scan = record ? { ObjUrl: record.objUrl } : await scanDeviceService.getScan(projectId, deviceId, scanId);
  if (!scan) {
    throw new ScanCalibrationNotFoundError(`Scan not found: ${scanId}`);
  }

  const objUrl = typeof scan.ObjUrl === "string" ? scan.ObjUrl : undefined;
  if (!objUrl || !objUrl.trim()) {
    throw new ScanCalibrationNotFoundError(`Scan ${scanId} does not have an ObjUrl.`);
  }

  // Uploaded calibration files and combined files are already local paths.
  const ws = getWorkstation();
  if (await ws.exists(objUrl)) {
    return objUrl;
  }

  // Normal scan files may be signed URLs.
  if (/^https?:\/\//i.test(objUrl)) {
    const tempDir = path.join(os.tmpdir(), "bp-scan-calibration");
    await ws.ensureDir(tempDir);

    const localPath = path.join(tempDir, `${scanId}.xyz`);
    if (await ws.exists(localPath)) {
      return localPath;
    }

    const response = await fetch(objUrl);
    if (!response.ok) {
      throw new Error(`Failed to download ${objUrl}: ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await ws.writeFile(localPath, buffer);
    return localPath;
  }

  throw new ScanCalibrationValidationError(`Scan ${scanId} ObjUrl is neither a valid local file nor an absolute URL: ${objUrl}`);
}

async function getCalibrationRecord(projectId: string, deviceId: string, scanId: string) {
  const [row] = await getDb()
    .select()
    .from(scanCalibrationRecords)
    .where(
      and(
        eq(scanCalibrationRecords.id, scanId),
        eq(scanCalibrationRecords.projectId, projectId),
        eq(scanCalibrationRecords.deviceId, deviceId),
      ),
    );
  return row ?? null;
}

/** Mirrors ScanCalibrationController.UploadXyz's docRef.SetAsync call. */
export async function createUploadedCalibrationScanDoc(
  projectId: string,
  deviceId: string,
  scanId: string,
  localPath: string,
  originalFileName: string,
): Promise<void> {
  const now = new Date();
  await getDb().insert(scanCalibrationRecords).values({
    id: scanId,
    projectId,
    deviceId,
    status: "complete",
    createdAt: now,
    startedAt: now,
    finishedAt: now,
    objUrl: localPath,
    error: null,
    isUploadedCalibrationScan: true,
    originalFileName,
  });
}

/** Mirrors ScanCalibrationController.CombineScans's docRef.SetAsync call. */
export async function createCombinedCalibrationScanDoc(
  projectId: string,
  deviceId: string,
  scanId: string,
  combined: CombinedScanResult,
  request: CombineScansRequest,
): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(scanCalibrationRecords)
    .values({
      id: scanId,
      projectId,
      deviceId,
      status: "complete",
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      // Same storage style as uploaded calibration scans for now. Later this can
      // become a Supabase Storage signed URL.
      objUrl: combined.OutputFilePath,
      error: null,
      isCombinedCalibrationScan: true,
      originalFileName: combined.OutputFileName,
      outputName: request.OutputName ?? null,
      scalarMmPerPixel: request.ScalarMmPerPixel ?? null,
      sourceScanIds: request.Items.map((i) => i.ScanId),
      combineTransforms: request.Items.map((i) => ({
        ScanId: i.ScanId,
        XTranslation: i.XTranslation,
        YTranslation: i.YTranslation,
        Theta: i.Theta,
      })),
    });
}

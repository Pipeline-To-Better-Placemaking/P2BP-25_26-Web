import path from "node:path";
import { Router } from "express";
import { env } from "../config/env.js";
import { getWorkstation } from "../workstation/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as rplidarService from "../services/rplidarService.js";
import * as visualizerSessionService from "../services/visualizerSessionService.js";
import type { Point2, Point3, RplidarScanResult } from "../models/rplidar.js";

/**
 * Ported from BetterPlacemaking.SERVER/Controllers/RplidarController.cs. That
 * controller only carries the class-level [Authorize(Policy = "UserJwt")] - no
 * [RequirePermission(...)] on any action - so every route below is
 * authenticated-only (requireAuth), same as trackingRouter/floorplanLibraryRouter.
 *
 * Not mounted in app.ts yet (a later migration step wires that up, same as every
 * other not-yet-mounted router in this codebase - see scanDevice.routes.ts /
 * tracking.routes.ts). Intended mount point: `/api/rplidar`, matching the old
 * server's literal `api/rplidar` route prefix.
 */
export const rplidarRouter = Router();

rplidarRouter.use(requireAuth);

function scanDirectory(): string {
  return env.rplidarScanDirectory;
}

/**
 * Security fix over the original: neither RplidarController.cs nor the first pass
 * of this port validated `:filename`/`FileName` before joining it onto the scan
 * directory, allowing path traversal (`../../etc/passwd`) on every read route and
 * arbitrary-file-write on upload. Resolves the joined path and rejects anything
 * that escapes scanDirectory() or isn't a plain filename.
 */
function resolveScanFilePath(filename: string): string | null {
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("\0")) return null;
  const dir = path.resolve(scanDirectory());
  const resolved = path.resolve(dir, filename);
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) return null;
  return resolved;
}

/**
 * Mirrors RplidarController.Subsample - even-stride downsampling by index (not
 * random sampling), used to cap point counts in the GET /scans/:filename
 * response for frontend rendering.
 */
function subsample<T>(points: T[], maxCount: number): T[] {
  if (points.length <= maxCount) return points;
  const result: T[] = [];
  const step = points.length / maxCount;
  for (let i = 0; i < maxCount; i++) {
    result.push(points[Math.floor(i * step)]);
  }
  return result;
}

// Reuses rplidarService's banker's-rounding helper (matches C#'s default
// Math.Round(double, 2) behavior) rather than a plain Math.round - the original
// controller's own Math.Round(p.X, 2) calls for point coordinates use the same
// default rounding mode as the service's cluster-field rounding.
function round2(value: number): number {
  return rplidarService.roundTo(value, 2);
}

function point2Dto(p: Point2): [number, number] {
  return [round2(p.X), round2(p.Y)];
}

function point3Dto(p: Point3): [number, number, number] {
  return [round2(p.X), round2(p.Y), round2(p.Z)];
}

/** Shared response shape builder for GET /scans/:filename and GET /from-scan - mirrors the identical anonymous-object literal both C# actions build. */
function buildScanResponse(
  result: RplidarScanResult,
  maxFloorPoints: number,
  maxCeilingPoints: number,
) {
  const floorSub = subsample(result.Floor, maxFloorPoints);
  const ceilSub = subsample(result.Ceiling, maxCeilingPoints);
  const wallSub = subsample(result.WallPoints, 3000);

  return {
    floor: floorSub.map(point2Dto),
    obstacles: result.Obstacles.map(point3Dto),
    clusterPoints: result.ClusterPoints.map(point3Dto),
    ceiling: ceilSub.map(point2Dto),
    wallPoints: wallSub.map(point2Dto),
    clusters: result.Clusters,
    meta: result.Meta,
  };
}

function parseIntQuery(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Mirrors RplidarController.ListScans. */
rplidarRouter.get("/scans", async (_req, res, next) => {
  try {
    const files = await rplidarService.listScanFiles(scanDirectory());
    res.status(200).json(files);
  } catch (err) {
    next(err);
  }
});

/**
 * Mirrors RplidarController.GetScan. NOTE: the original controller accepts
 * `floorThreshold`/`ceilingThreshold` query params but never forwards them
 * anywhere (RplidarScanService.Reclassify, the method that would use them, is
 * never called from GetScan) - ported faithfully, including that gap: the
 * params are parsed here too but have no effect on the response.
 */
rplidarRouter.get("/scans/:filename", async (req, res, next) => {
  try {
    const filePath = resolveScanFilePath(req.params.filename);
    if (!filePath || !(await getWorkstation().exists(filePath))) {
      res.status(404).json({ error: `Scan file '${req.params.filename}' not found` });
      return;
    }

    const result = await rplidarService.parseXyzFile(filePath);
    const maxFloorPoints = parseIntQuery(req.query.maxFloorPoints, 1500);
    const maxCeilingPoints = parseIntQuery(req.query.maxCeilingPoints, 800);

    res.status(200).json(buildScanResponse(result, maxFloorPoints, maxCeilingPoints));
  } catch (err) {
    next(err);
  }
});

/** Mirrors RplidarController.GetObstacles. */
rplidarRouter.get("/scans/:filename/obstacles", async (req, res, next) => {
  try {
    const filePath = resolveScanFilePath(req.params.filename);
    if (!filePath || !(await getWorkstation().exists(filePath))) {
      res.status(404).json({ error: `Scan file '${req.params.filename}' not found` });
      return;
    }

    const result = await rplidarService.parseXyzFile(filePath);
    res.status(200).json(result.Clusters);
  } catch (err) {
    next(err);
  }
});

/** Mirrors RplidarController.GetFloorplan. */
rplidarRouter.get("/scans/:filename/floorplan", async (req, res, next) => {
  try {
    const filePath = resolveScanFilePath(req.params.filename);
    if (!filePath || !(await getWorkstation().exists(filePath))) {
      res.status(404).json({ error: `Scan file '${req.params.filename}' not found` });
      return;
    }

    const result = await rplidarService.parseXyzFile(filePath);

    let fMinX = Number.POSITIVE_INFINITY;
    let fMaxX = Number.NEGATIVE_INFINITY;
    let fMinY = Number.POSITIVE_INFINITY;
    let fMaxY = Number.NEGATIVE_INFINITY;
    for (const p of result.Floor) {
      if (p.X < fMinX) fMinX = p.X;
      if (p.X > fMaxX) fMaxX = p.X;
      if (p.Y < fMinY) fMinY = p.Y;
      if (p.Y > fMaxY) fMaxY = p.Y;
    }

    res.status(200).json({
      floorBounds: {
        minX: round2(fMinX),
        maxX: round2(fMaxX),
        minY: round2(fMinY),
        maxY: round2(fMaxY),
      },
      obstacles: result.Clusters.map((c) => ({
        Id: c.Id,
        Type: c.Type,
        CenterX: c.CenterX,
        CenterY: c.CenterY,
        MinX: c.MinX,
        MaxX: c.MaxX,
        MinY: c.MinY,
        MaxY: c.MaxY,
        Width: c.Width,
        Depth: c.Depth,
        AvgHeight: c.AvgHeight,
        MaxHeight: c.MaxHeight,
      })),
      meta: result.Meta,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Mirrors RplidarController.UploadScan. NOTE: the original is
 * `[Consumes("multipart/form-data")]` with an IFormFile; this server has no
 * multipart-parsing package (multer/busboy - see floorplanLibrary.routes.ts,
 * which hit the same gap), so the request body is adapted to JSON carrying a
 * base64-encoded file instead: `{ FileName, FileBase64 }`. FileBase64 may be a
 * raw base64 string or a data: URL (the prefix up to the first comma is
 * stripped), matching floorplanLibrary.routes.ts's convention.
 */
rplidarRouter.post("/upload", async (req, res, next) => {
  try {
    const { FileName, FileBase64 } = req.body ?? {};

    if (!FileBase64 || typeof FileBase64 !== "string") {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    if (!FileName || typeof FileName !== "string" || !FileName.toLowerCase().endsWith(".xyz")) {
      res.status(400).json({ error: "Only .xyz files are supported" });
      return;
    }

    const dir = scanDirectory();
    await getWorkstation().ensureDir(dir);
    const destPath = resolveScanFilePath(FileName);
    if (!destPath) {
      res.status(400).json({ error: "Invalid file name" });
      return;
    }

    const commaIndex = FileBase64.indexOf(",");
    const base64Data = commaIndex >= 0 ? FileBase64.slice(commaIndex + 1) : FileBase64;
    const fileBuffer = Buffer.from(base64Data, "base64");
    await getWorkstation().writeFile(destPath, fileBuffer);

    const result = await rplidarService.parseXyzFile(destPath);
    res.status(200).json({
      filename: FileName,
      meta: result.Meta,
      clusterCount: result.Clusters.length,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Mirrors RplidarController.FromScan ("Object detection from current visualizer point
 * cloud"). Now that the Visualizer subsystem has an Express port (see
 * visualizerSessionService.ts / visualizer.routes.ts), this reads its in-memory point-cloud
 * session the same way the original read VisualizerController.SnapshotCurrentPointsForRplidar()
 * - a snapshot of the SAME shared, server-wide, module-level session both routers' modules read
 * (see visualizerSessionService.ts's file header for why that's an inherited limitation, not new
 * here). An empty snapshot takes the same 404 branch the original did (either because nothing
 * was ever loaded, or because DELETE /api/visualizer/points cleared it).
 */
rplidarRouter.get("/from-scan", async (req, res, next) => {
  let points;
  try {
    points = await visualizerSessionService.snapshotPointsForRplidar();
  } catch (err) {
    next(err);
    return;
  }
  if (points.length === 0) {
    res.status(404).json({ error: "No point cloud loaded. Upload a scan or load a room in the 3D view first." });
    return;
  }

  try {
    // rplidarService.parseFromPointCloud only reads X/Y/Z (see rplidarService.ts) but declares
    // its own local LidarPoint3D shape (models/rplidar.ts) rather than importing the Visualizer
    // subsystem's - map down to just those fields rather than importing across subsystems.
    const result = rplidarService.parseFromPointCloud(points.map((p) => ({ X: p.X, Y: p.Y, Z: p.Z })));
    const maxFloorPoints = parseIntQuery(req.query.maxFloorPoints, 1500);
    const maxCeilingPoints = parseIntQuery(req.query.maxCeilingPoints, 800);

    res.status(200).json(buildScanResponse(result, maxFloorPoints, maxCeilingPoints));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

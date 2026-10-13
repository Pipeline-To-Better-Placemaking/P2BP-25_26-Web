import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { getWorkstation } from "../workstation/index.js";
import * as sessionService from "../services/visualizerSessionService.js";
import * as geometryService from "../services/visualizerGeometryService.js";
import { Delaunay3DNotSupportedError } from "../services/visualizerMeshService.js";
import * as scanService from "../services/scanService.js";
import type { LidarPoint3D, MeshGenerationRequest, ScannerUploadRequest } from "../models/visualizer.js";

/**
 * Ported from BetterPlacemaking.SERVER/Controllers/VisualizerController.cs (666 lines). Endpoint
 * contract (confirmed from the old route table, `[Route("api/[controller]")]` -> `api/visualizer`):
 *
 *   GET    /api/visualizer/points                  -> LidarPoint3D[]
 *   GET    /api/visualizer/points-meta              -> { PointCount, Revision }
 *   POST   /api/visualizer/scanner/upload?projectId=&projectName=
 *   POST   /api/visualizer/upload/obj?projectId=&projectName=
 *   POST   /api/visualizer/upload/xyz?sensorId=&projectId=&projectName=
 *   POST   /api/visualizer/upload/ply?maxPoints=&projectId=&projectName=
 *   GET    /api/visualizer/geometry/room            -> GalleryGeometry
 *   POST   /api/visualizer/geometry/mesh            -> text/plain OBJ
 *   GET    /api/visualizer/export/obj               -> text/plain
 *   GET    /api/visualizer/export/csv               -> text/csv
 *   GET    /api/visualizer/export/xyz               -> text/plain (400 if no points loaded)
 *   GET    /api/visualizer/export/xyz-rgb           -> text/plain (400 if no points loaded)
 *   GET    /api/visualizer/export/txt               -> text/plain (400 if no points loaded)
 *   GET    /api/visualizer/export/pts               -> text/plain (400 if no points loaded)
 *   GET    /api/visualizer/export/ply               -> text/plain (400 if no points loaded)
 *   GET    /api/visualizer/export/geometry/json     -> application/json
 *   DELETE /api/visualizer/points                   -> { message }
 *
 * Not wired into app.ts yet (a later migration/consolidation step mounts it, same as
 * fusionRouter/scanDeviceRouter before it); intended mount point is `/api/visualizer`.
 *
 * Auth: the old controller carries only the class-level `[Authorize(Policy = "UserJwt")]` - no
 * `[RequirePermission(...)]` on any action - so every route below is authenticated-only
 * (requireAuth), same as rplidarRouter/floorplanLibraryRouter.
 *
 * SESSION STATE: every action here reads/writes a single server-wide in-memory point
 * cloud/mesh "session" - see visualizerSessionService.ts for the full explanation of why (an
 * inherited architectural limitation from the original single-instance ASP.NET server, ported
 * faithfully rather than redesigned).
 *
 * FILE UPLOADS: the 3 upload/{obj,xyz,ply} endpoints and scanner/upload are
 * `[DisableRequestSizeLimit]` `IFormFile`/JSON actions in the original. This server has no
 * multipart-parsing package (multer/busboy - see floorplanLibrary.routes.ts, which hit the same
 * gap), so file bodies are adapted to JSON carrying base64-encoded content instead, following
 * that same established convention:
 *   - upload/obj:  { FileName, FileBase64 }
 *   - upload/ply:  { FileName, FileBase64 }  (?maxPoints= query, matching the original)
 *   - upload/xyz:  { FileNameA?, FileBase64A?, FileNameB?, FileBase64B?, Units? } (?sensorId= query)
 * FileBase64(A/B) may be a raw base64 string or a data: URL (the prefix up to the first comma is
 * stripped), matching floorplanLibrary.routes.ts/rplidar.routes.ts's convention. OBJ/PLY content
 * is decoded straight to a string and handed to visualizerParserService (which parses OBJ/PLY
 * from content directly - see that file's header comment), so no temp file is needed for those
 * two. XYZ parsing keeps its original on-disk-file-path signature (XyzParserService.cs always
 * read from a path), so upload/xyz decodes to a temp file under the OS temp dir, parses it, and
 * deletes it in a `finally` - mirroring the original's own uploads-dir write + cleanup exactly,
 * just using the OS temp dir instead of a `ContentRootPath/uploads/visualizer` folder (this
 * server has no IWebHostEnvironment-style content-root concept).
 *
 * NOTIFICATIONS: TryNotifyScanCompleted's target, NotificationService.NotifyScanCompleted, has no
 * Express port (email sending - out of scope for this Visualizer-only task). This reuses the
 * existing no-op stand-in scanService.notifyScanCompleted (see scanService.ts's own
 * TODO(scan-notifications) - scan.routes.ts's ScanController.UpdateScanStatus wiring already
 * follows this same "call the no-op stub, one-line swap later" pattern), called only when both a
 * resolved userId and a non-blank projectId query param are present, matching the original's
 * guard clause exactly. `projectName` is accepted (for request-shape parity with the original's
 * query string) but unused, since the no-op stub has no parameter for it.
 */
export const visualizerRouter = Router();

visualizerRouter.use(requireAuth);

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Mirrors VisualizerController.TryNotifyScanCompleted / ResolveCurrentUserId. */
function tryNotifyScanCompleted(req: Request, projectId: unknown): void {
  try {
    const userId = req.user?.sub;
    const pid = typeof projectId === "string" ? projectId : undefined;
    if (!userId || !pid?.trim()) return;
    scanService.notifyScanCompleted(userId, pid);
  } catch (err) {
    console.warn(`Warning: Failed to send scan completion notification: ${(err as Error).message}`);
  }
}

/** Express 4 does not catch rejected promises from async handlers; forward them to errorHandler. */
function safe(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

/** Decodes a raw-base64-or-data-URL string to a Buffer, matching floorplanLibrary.routes.ts/rplidar.routes.ts's convention. */
function decodeBase64(base64: string): Buffer {
  const commaIndex = base64.indexOf(",");
  const base64Data = commaIndex >= 0 ? base64.slice(commaIndex + 1) : base64;
  return Buffer.from(base64Data, "base64");
}

function visualizerTempUploadsDir(): string {
  return path.join(os.tmpdir(), "betterplacemaking-visualizer-uploads");
}

/** Writes a decoded upload to a uniquely-named temp file, mirroring the original's `{Guid.NewGuid()}_{file.FileName}` naming under its uploads dir. */
async function writeTempUpload(fileName: string, base64: string): Promise<string> {
  const ws = getWorkstation();
  const dir = visualizerTempUploadsDir();
  await ws.ensureDir(dir);
  const destPath = path.join(dir, `${randomUUID()}_${fileName}`);
  await ws.writeFile(destPath, decodeBase64(base64));
  return destPath;
}

/** Shared `_currentPoints.Count == 0` guard used by export/{xyz,xyz-rgb,txt,pts,ply} - export/{obj,csv} have no such guard in the original. */
async function requireNonEmptyPoints(res: Response): Promise<LidarPoint3D[] | null> {
  const points = await sessionService.getPoints();
  if (points.length === 0) {
    res.status(400).json("No point cloud loaded.");
    return null;
  }
  return points;
}

// ─── Point Cloud Endpoints ───────────────────────────────────────────────────

/** Mirrors VisualizerController.GetPoints. */
visualizerRouter.get("/points", safe(async (_req, res) => {
  res.status(200).json(await sessionService.getPoints());
}));

/** Mirrors VisualizerController.GetPointsMeta. */
visualizerRouter.get("/points-meta", safe(async (_req, res) => {
  res.status(200).json(await sessionService.getPointsMeta());
}));

/** Mirrors VisualizerController.UploadScannerData. */
visualizerRouter.post("/scanner/upload", async (req, res) => {
  const body = req.body as ScannerUploadRequest | undefined;
  if (!body?.Points || body.Points.length === 0) {
    res.status(400).json("No points provided");
    return;
  }

  try {
    const result = await sessionService.uploadScannerData(body);
    tryNotifyScanCompleted(req, req.query.projectId);
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** Mirrors VisualizerController.UploadObjFile. */
visualizerRouter.post("/upload/obj", async (req, res, next) => {
  try {
    const { FileName, FileBase64 } = (req.body ?? {}) as { FileName?: string; FileBase64?: string };

    if (!FileBase64 || typeof FileBase64 !== "string") {
      res.status(400).json("No file uploaded");
      return;
    }
    if (!FileName || typeof FileName !== "string" || !FileName.toLowerCase().endsWith(".obj")) {
      res.status(400).json("File must be an OBJ file");
      return;
    }

    const content = decodeBase64(FileBase64).toString("utf-8");
    const fileName = `${randomUUID()}_${FileName}`;
    const result = await sessionService.loadFromObj(content);

    tryNotifyScanCompleted(req, req.query.projectId);
    res.status(200).json({ fileName, ...result });
  } catch (err) {
    // The original has no catch here (only a `finally` for on-disk cleanup, which this port
    // doesn't need since OBJ parsing works off the decoded content directly - no temp file) -
    // an unhandled parse exception fell through to ASP.NET's default 500 handling. `next(err)`
    // reproduces that via errorHandler.ts, matching this codebase's universal route convention.
    next(err);
  }
});

/** Mirrors VisualizerController.UploadXyzFile. */
visualizerRouter.post("/upload/xyz", async (req, res) => {
  const { FileNameA, FileBase64A, FileNameB, FileBase64B, Units } = (req.body ?? {}) as {
    FileNameA?: string;
    FileBase64A?: string;
    FileNameB?: string;
    FileBase64B?: string;
    Units?: string;
  };
  const sensorId = typeof req.query.sensorId === "string" ? req.query.sensorId : undefined;

  const hasA = typeof FileBase64A === "string" && FileBase64A.length > 0;
  const hasB = typeof FileBase64B === "string" && FileBase64B.length > 0;
  if (!hasA && !hasB) {
    res.status(400).json("At least one .xyz file must be uploaded");
    return;
  }

  let filePathA: string | null = null;
  let filePathB: string | null = null;

  try {
    if (hasA) filePathA = await writeTempUpload(FileNameA ?? "a.xyz", FileBase64A as string);
    if (hasB) filePathB = await writeTempUpload(FileNameB ?? "b.xyz", FileBase64B as string);

    const unitsVal = typeof Units === "string" && Units.toLowerCase() === "m" ? "m" : "mm";

    // Preserved quirk from VisualizerController.UploadXyzFile: the original force-unwraps
    // filePathA (`filePathA!`) without actually checking it was set - if only the B file is
    // uploaded, filePathA stays null there too and the underlying parser throws, which the
    // surrounding try/catch turns into a 400 `{ error }` response rather than a crash. Passing
    // `filePathA` through as-is (possibly null) reproduces that behavior via the catch below,
    // rather than special-casing a "fileA is required" rule the original never actually enforced.
    const result = await sessionService.loadFromXyzFiles(filePathA as string, filePathB, sensorId, unitsVal);

    tryNotifyScanCompleted(req, req.query.projectId);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof sessionService.NoValidPointsError) {
      res.status(400).json(err.message);
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  } finally {
    try {
      if (filePathA) await getWorkstation().remove(filePathA);
      if (filePathB) await getWorkstation().remove(filePathB);
    } catch {
      // Best-effort cleanup, mirrors the original's empty `catch { }` around file deletion.
    }
  }
});

/** Mirrors VisualizerController.UploadPlyFile. */
visualizerRouter.post("/upload/ply", async (req, res) => {
  const { FileName, FileBase64 } = (req.body ?? {}) as { FileName?: string; FileBase64?: string };

  if (!FileBase64 || typeof FileBase64 !== "string") {
    res.status(400).json("No file uploaded");
    return;
  }
  if (!FileName || typeof FileName !== "string" || !FileName.toLowerCase().endsWith(".ply")) {
    res.status(400).json("File must be a PLY file");
    return;
  }

  const rawMaxPoints = req.query.maxPoints ? Number(req.query.maxPoints) : 0;
  const maxPoints = Number.isFinite(rawMaxPoints) ? rawMaxPoints : 0;

  try {
    const content = decodeBase64(FileBase64).toString("utf-8");
    const result = await sessionService.loadFromPly(content, maxPoints);

    tryNotifyScanCompleted(req, req.query.projectId);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof sessionService.NoValidPointsError) {
      res.status(400).json(err.message);
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

// ─── Geometry Endpoints ──────────────────────────────────────────────────────

/** Mirrors VisualizerController.GetRoomGeometry. */
visualizerRouter.get("/geometry/room", safe(async (_req, res) => {
  res.status(200).json(await sessionService.getGeometry());
}));

// ─── Mesh Endpoints ──────────────────────────────────────────────────────────

/** Mirrors VisualizerController.GenerateMesh. */
visualizerRouter.post("/geometry/mesh", async (req, res) => {
  try {
    const body = req.body as MeshGenerationRequest | undefined;
    const content = await sessionService.generateMesh(body);
    res.status(200).type("text/plain").send(content);
  } catch (err) {
    if (err instanceof sessionService.NoPointsAvailableError || err instanceof sessionService.NoFacesGeneratedError) {
      res.status(400).type("text/plain").send(err.message);
      return;
    }
    if (err instanceof Delaunay3DNotSupportedError) {
      // Defensive only - see the NOTE in visualizerSessionService.ts's generateMesh: this never
      // actually happens today (createWatertightMesh always catches it and falls back to 2.5D
      // internally), but surfaces clearly instead of as an unhandled 500 if that ever changes.
      res.status(503).type("text/plain").send(`Error generating mesh: ${err.message}`);
      return;
    }
    res.status(400).type("text/plain").send(`Error generating mesh: ${(err as Error).message}`);
  }
});

// ─── Export Endpoints ────────────────────────────────────────────────────────

/** Mirrors VisualizerController.ExportObj. */
visualizerRouter.get("/export/obj", safe(async (_req, res) => {
  res.status(200).type("text/plain").send(geometryService.exportPointCloudToObj(await sessionService.getPoints()));
}));

/** Mirrors VisualizerController.ExportCsv. */
visualizerRouter.get("/export/csv", safe(async (_req, res) => {
  res.status(200).type("text/csv").send(geometryService.exportToCsv(await sessionService.getPoints()));
}));

/** Mirrors VisualizerController.ExportXyz. */
visualizerRouter.get("/export/xyz", safe(async (_req, res) => {
  const points = await requireNonEmptyPoints(res);
  if (!points) return;
  res.status(200).type("text/plain").send(geometryService.exportToXyz(points));
}));

/** Mirrors VisualizerController.ExportXyzRgb. */
visualizerRouter.get("/export/xyz-rgb", safe(async (_req, res) => {
  const points = await requireNonEmptyPoints(res);
  if (!points) return;
  res.status(200).type("text/plain").send(geometryService.exportToXyzRgb(points));
}));

/** Mirrors VisualizerController.ExportTxt. */
visualizerRouter.get("/export/txt", safe(async (_req, res) => {
  const points = await requireNonEmptyPoints(res);
  if (!points) return;
  res.status(200).type("text/plain").send(geometryService.exportToTxt(points));
}));

/** Mirrors VisualizerController.ExportPts. */
visualizerRouter.get("/export/pts", safe(async (_req, res) => {
  const points = await requireNonEmptyPoints(res);
  if (!points) return;
  res.status(200).type("text/plain").send(geometryService.exportToPts(points));
}));

/** Mirrors VisualizerController.ExportPly. */
visualizerRouter.get("/export/ply", safe(async (_req, res) => {
  const points = await requireNonEmptyPoints(res);
  if (!points) return;
  res.status(200).type("text/plain").send(geometryService.exportToPly(points));
}));

/** Mirrors VisualizerController.ExportGeometryJson. exportGeometryToJson already returns a serialized JSON string, so this sends it verbatim with the right Content-Type rather than res.json() (which would double-encode it as a JSON string literal). */
visualizerRouter.get("/export/geometry/json", safe(async (_req, res) => {
  const geometry = await sessionService.getGeometry();
  res.status(200).type("application/json").send(geometryService.exportGeometryToJson(geometry));
}));

/** Mirrors VisualizerController.ClearPoints. */
visualizerRouter.delete("/points", safe(async (_req, res) => {
  await sessionService.clearPoints();
  res.status(200).json({ message: "Point cloud cleared." });
}));

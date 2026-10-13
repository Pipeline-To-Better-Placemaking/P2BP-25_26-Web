import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import type { Response } from "express";
import { getWorkstation } from "../workstation/index.js";
import * as scanCalibrationService from "../services/scanCalibrationService.js";
import { bindCombineScansRequest } from "../models/scanCalibration.js";
import type { CombineCloudInput } from "../models/scanCalibration.js";

/**
 * Ported from BetterPlacemaking.SERVER/Controllers/ScanCalibrationController.cs
 * (old route `api/ScanCalibration`, mounted here at `/api/scan-calibration` to match
 * this server's hyphenated single-segment resource convention).
 *
 * ============================ SECURITY: NO AUTH ============================
 * ScanCalibrationController carries NO [Authorize] attribute, and Program.cs sets
 * options.DefaultPolicy but NOT options.FallbackPolicy, and calls app.MapControllers()
 * without .RequireAuthorization() - so on the old server all four of these endpoints are
 * reachable ANONYMOUSLY. It is the only controller in the old codebase that is
 * unauthenticated without being an auth/login/register/email flow, which makes this look
 * far more like an oversight than a decision: these endpoints read arbitrary project
 * scan documents, download their signed URLs, and WRITE new scan documents.
 *
 * It is ported faithfully (no auth middleware) so this migration does not silently change
 * behaviour and break whatever calls it. This is flagged in the migration report for an
 * explicit decision. To close it, add `scanCalibrationRouter.use(requireAuth)` plus
 * `requirePermission(Permissions.Project.ScansRead)` on the two GETs and
 * `Permissions.Project.ScansStart` on the two POSTs - mirroring scan.routes.ts.
 * ==========================================================================
 *
 * ERROR MAPPING: every action in the old controller wraps its entire body in
 * `try { ... } catch (Exception ex) { return Problem(ex.Message); }`, and ASP.NET's
 * `Problem(string)` defaults to status 500. So "scan not found", "no ObjUrl" and
 * "XYZ file not found" are 500s on the old server, NOT 404s. Only the literal
 * `BadRequest(...)`/`NotFound(...)` calls written in the method bodies produce 400/404.
 * That surprising-but-faithful mapping is reproduced exactly below; see the header
 * comment in scanCalibrationService.ts for the same note.
 */
export const scanCalibrationRouter = Router();

/** Mirrors `return Problem(ex.Message);` - ASP.NET's Problem(string) is a 500. */
function problem(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : "An unexpected error occurred.";
  res.status(500).json({ Message: message });
}

// Matches ScanCalibrationController.GetPreview.
scanCalibrationRouter.get("/:projectId/:deviceId/:scanId/preview", async (req, res) => {
  try {
    const { projectId, deviceId, scanId } = req.params;
    const xyzPath = await scanCalibrationService.resolveLocalXyzPath(projectId, deviceId, scanId);
    const png = await scanCalibrationService.renderPreviewPngFromFile(xyzPath);

    // Matches `return File(png, "image/png");`
    res.status(200).contentType("image/png").send(png);
  } catch (err) {
    problem(res, err);
  }
});

// Matches ScanCalibrationController.UploadXyz.
//
// The old action takes an `IFormFile file` (multipart/form-data). This server has no
// multipart-parsing package (multer/busboy), so - exactly as floorplanLibrary.routes.ts
// already does for its 25MB image upload - the body is adapted to JSON:
//   { FileBase64: string, FileName: string }
// The two BadRequest guards below are the same two the old action performs, with
// "no file uploaded" covering a missing/empty FileBase64.
scanCalibrationRouter.post("/:projectId/:deviceId/upload-xyz", async (req, res) => {
  try {
    const { projectId, deviceId } = req.params;
    const { FileBase64, FileName } = (req.body ?? {}) as { FileBase64?: string; FileName?: string };

    if (!FileBase64 || typeof FileBase64 !== "string" || FileBase64.length === 0) {
      res.status(400).send("No file uploaded.");
      return;
    }

    const contents = Buffer.from(FileBase64, "base64");
    if (contents.length === 0) {
      res.status(400).send("No file uploaded.");
      return;
    }

    if (!FileName || !FileName.toLowerCase().endsWith(".xyz")) {
      res.status(400).send("Only .xyz files are allowed.");
      return;
    }

    const tempDir = path.join(os.tmpdir(), "bp-uploaded-xyz");
    await getWorkstation().ensureDir(tempDir);

    // Guid.NewGuid().ToString("N") - 32 hex characters, no dashes.
    const scanId = randomUUID().replace(/-/g, "");
    const localPath = path.join(tempDir, `${scanId}.xyz`);
    await getWorkstation().writeFile(localPath, contents);

    await scanCalibrationService.createUploadedCalibrationScanDoc(
      projectId,
      deviceId,
      scanId,
      localPath,
      FileName,
    );

    res.status(200).json({
      Id: scanId,
      Status: "complete",
      ObjUrl: localPath,
      OriginalFileName: FileName,
    });
  } catch (err) {
    problem(res, err);
  }
});

// Matches ScanCalibrationController.DownloadScanFile.
scanCalibrationRouter.get("/:projectId/:deviceId/:scanId/download", async (req, res) => {
  try {
    const { projectId, deviceId, scanId } = req.params;
    const localPath = await scanCalibrationService.resolveLocalXyzPath(projectId, deviceId, scanId);

    if (!(await getWorkstation().exists(localPath))) {
      res.status(404).send("File not found.");
      return;
    }

    // Matches `PhysicalFile(localPath, "application/octet-stream", fileName)`: passing a
    // fileName to PhysicalFile is what makes it send a Content-Disposition attachment
    // header, so that header is set explicitly here rather than only the content type.
    const fileName = path.basename(localPath);
    res
      .status(200)
      .contentType("application/octet-stream")
      .setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(await getWorkstation().readBytes(localPath));
  } catch (err) {
    problem(res, err);
  }
});

// Matches ScanCalibrationController.CombineScans.
scanCalibrationRouter.post("/:projectId/:deviceId/combine", async (req, res) => {
  try {
    const { projectId, deviceId } = req.params;
    // Reproduces ASP.NET's model binding rather than reading req.body directly - see
    // bindCombineScansRequest for why that distinction is load-bearing here.
    const request = bindCombineScansRequest(req.body);

    if (request.Items.length < 2) {
      res.status(400).send("At least two scans are required.");
      return;
    }

    // Resolved sequentially rather than via Promise.all: the C# `.Select(...)` runs
    // ResolveLocalXyzPath one item at a time, and that method can download a file into a
    // shared cache path, so concurrency here would be a behavioural change, not a speedup.
    const inputs: CombineCloudInput[] = [];
    for (const item of request.Items) {
      inputs.push({
        XyzFilePath: await scanCalibrationService.resolveLocalXyzPath(projectId, deviceId, item.ScanId),
        XTranslation: item.XTranslation,
        YTranslation: item.YTranslation,
        Theta: item.Theta,
      });
    }

    const outputDirectory = path.join(os.tmpdir(), "bp-combined-scans");
    await getWorkstation().ensureDir(outputDirectory);

    const combined = await scanCalibrationService.combineClouds(inputs, outputDirectory, request.OutputName);

    const scanId = randomUUID().replace(/-/g, "");
    await scanCalibrationService.createCombinedCalibrationScanDoc(
      projectId,
      deviceId,
      scanId,
      combined,
      request,
    );

    res.status(200).json({
      Id: scanId,
      Status: "complete",
      ObjUrl: combined.OutputFilePath,
      OriginalFileName: combined.OutputFileName,
      IsCombinedCalibrationScan: true,
    });
  } catch (err) {
    problem(res, err);
  }
});

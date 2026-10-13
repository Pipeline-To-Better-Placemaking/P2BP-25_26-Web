import { Router } from "express";
import type { Request } from "express";
import * as scanService from "../services/scanService.js";
import * as deviceService from "../services/deviceService.js";
import { Permissions } from "../authorization/permissions.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validateScanSettings } from "../models/scan.js";
import type { ScanSettingsRequest, UpdateScanStatusRequest } from "../models/scan.js";

/**
 * Ported from BetterPlacemaking.SERVER/Controllers/ScanController.cs - the user-facing scan
 * history/history resource (start/list/get/delete scans, plus the .xyz download and
 * visualizer-preload endpoints), as opposed to scanDeviceRouter's device-authenticated command
 * queue (ScanDeviceController.cs). Both operate on the same database scan documents under
 * `projects/{projectId}/devices/{deviceId}/scans` - see scanService.ts.
 *
 * The old route was `api/[controller]` = `api/Scan`. Not wired into app.ts yet (another
 * migration step mounts it, same as scanDeviceRouter/scanScheduleRouter before it); intended
 * mount point is `/api/scan`, matching this server's flat, hyphenated single-segment resource
 * convention (/api/device, /api/scan-device, /api/scan-schedule, ...).
 *
 * Not ported (see scanService.ts for the exact stand-ins and why): the visualizer ingest
 * pipeline (ScanCompleteVisualizerIngestService - an entire in-memory 3D-visualizer subsystem
 * with no Express port yet) and scan-completion email notifications (NotificationService, also
 * not yet ported). Both are fire-and-forget side effects on the old server; every endpoint below
 * still performs its own database read/write correctly without them.
 */
export const scanRouter = Router();

scanRouter.use(requireAuth);

function resolveCurrentUserId(req: Request): string | null {
  // Mirrors ScanController.ResolveCurrentUserId's claim fallback chain, collapsed to this
  // server's single JWT claims shape (see tokenService.ts's JwtClaims - always `sub`).
  return req.user?.sub ?? null;
}

scanRouter.post("/:projectId/:deviceId", requirePermission(Permissions.Project.ScansStart), async (req, res, next) => {
  try {
    const { projectId, deviceId } = req.params;
    if (!projectId?.trim() || !deviceId?.trim()) {
      res.status(400).send();
      return;
    }

    const settings = req.body as ScanSettingsRequest | undefined;
    if (!settings) {
      res.status(400).json("Scan settings are required.");
      return;
    }

    const validationError = validateScanSettings(settings);
    if (validationError) {
      res.status(400).json({ reason: "invalid_scan_settings", message: validationError });
      return;
    }

    const existing = await scanService.hasPendingOrRunningScan(projectId, deviceId);
    if (existing.exists) {
      if (existing.status?.toLowerCase() === "running") {
        res.status(409).json({
          reason: "scan_in_progress",
          message: "A scan is already running for this device.",
          scanId: existing.scanId,
          status: existing.status,
        });
        return;
      }

      // Pending means the orchestrator hasn't claimed it yet - re-arm the device flag in case
      // the first heartbeat delivery was lost, and return the existing scan so a retry from the
      // UI is idempotent rather than stuck behind a 409.
      await scanService.requestLidarScanWake(deviceId, settings);
      res.status(200).json({ Id: existing.scanId, Status: existing.status });
      return;
    }

    const userId = resolveCurrentUserId(req);
    const response = await scanService.createScan(projectId, deviceId, settings, userId);
    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
});

scanRouter.get("/:projectId/:deviceId", requirePermission(Permissions.Project.ScansRead), async (req, res, next) => {
  try {
    const { projectId, deviceId } = req.params;
    if (!projectId?.trim() || !deviceId?.trim()) {
      res.status(400).send();
      return;
    }

    const scans = await scanService.getScans(projectId, deviceId);
    res.status(200).json(scans);
  } catch (err) {
    next(err);
  }
});

/**
 * Streams the raw .xyz point cloud for a scan. See scanService.downloadScanXyz's TODO - always
 * unavailable until CloudStorageService's raw-download path and the ObjUrl HTTPS fetch are
 * ported, so this always reaches the "xyz_unavailable" branch below (matching
 * ScanController.DownloadScanXyz's own 404 when its ingest service can't resolve a stream).
 */
scanRouter.get(
  "/:projectId/:deviceId/:scanId/xyz",
  requirePermission(Permissions.Project.Export),
  async (req, res, next) => {
    try {
      const { projectId, deviceId, scanId } = req.params;
      if (!projectId?.trim() || !deviceId?.trim() || !scanId?.trim()) {
        res.status(400).send();
        return;
      }

      const scan = await scanService.getScanRaw(projectId, deviceId, scanId);
      if (!scan) {
        res.status(404).send();
        return;
      }

      const bytes = await scanService.downloadScanXyz(projectId, deviceId, scan);
      if (!bytes) {
        res.status(404).json({ reason: "xyz_unavailable" });
        return;
      }

      res.status(200).type("text/plain").attachment(`${scanId}.xyz`).send(bytes);
    } catch (err) {
      next(err);
    }
  },
);

scanRouter.get(
  "/:projectId/:deviceId/:scanId",
  requirePermission(Permissions.Project.ScansRead),
  async (req, res, next) => {
    try {
      const { projectId, deviceId, scanId } = req.params;
      if (!projectId?.trim() || !deviceId?.trim() || !scanId?.trim()) {
        res.status(400).send();
        return;
      }

      const scan = await scanService.getScan(projectId, deviceId, scanId);
      if (!scan) {
        res.status(404).send();
        return;
      }
      res.status(200).json(scan);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Loads the newest `complete` device scan for this project into the in-memory visualizer.
 * deviceId/scanId resolution below is real (reuses deviceService.getDevicesByProjectId and
 * scanService.getLatestCompleteScanForProject); the actual "load into visualizer" step is
 * stubbed (see scanService.ingestLatestCompleteScanForVisualizer's TODO), so this always resolves
 * with success:false/reason:"not_implemented" once a candidate scan is found.
 */
scanRouter.post(
  "/:projectId/visualizer/latest",
  requirePermission(Permissions.Project.ScansRead),
  async (req, res, next) => {
    try {
      const { projectId } = req.params;
      if (!projectId?.trim()) {
        res.status(400).send();
        return;
      }

      const devices = await deviceService.getDevicesByProjectId(projectId);
      const deviceIds = devices.map((d) => d.Id).filter((id): id is string => !!id?.trim());
      if (deviceIds.length === 0) {
        res.status(200).json({ success: false, reason: "no_devices", message: "No devices assigned to this project." });
        return;
      }

      const latest = await scanService.getLatestCompleteScanForProject(projectId, deviceIds);
      if (!latest) {
        res
          .status(200)
          .json({ success: false, reason: "no_complete_scan", message: "No completed lidar scan for this project." });
        return;
      }

      const result = await scanService.ingestLatestCompleteScanForVisualizer();
      if (result.loaded) {
        res.status(200).json({ success: true, deviceId: latest.deviceId, scanId: latest.scan.Id });
        return;
      }

      res.status(200).json({ success: false, reason: result.reason, message: result.message, deviceId: latest.deviceId });
    } catch (err) {
      next(err);
    }
  },
);

scanRouter.delete(
  "/:projectId/:deviceId/:scanId",
  requirePermission(Permissions.Project.ScansDelete),
  async (req, res, next) => {
    try {
      const { projectId, deviceId, scanId } = req.params;
      if (!projectId?.trim() || !deviceId?.trim() || !scanId?.trim()) {
        res.status(400).json("Invalid parameters.");
        return;
      }

      const success = await scanService.deleteScan(projectId, deviceId, scanId);
      if (!success) {
        res.status(404).json("Scan not found.");
        return;
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// Matches ScanController.UpdateScanStatus: no [RequirePermission] attribute on the old action,
// only the controller-level [Authorize(Policy = "UserJwt")] - ported faithfully (requireAuth
// only, same as scanRouter.use above), not tightened.
scanRouter.patch("/:projectId/:deviceId/:scanId/status", async (req, res, next) => {
  try {
    const { projectId, deviceId, scanId } = req.params;
    const body = req.body as UpdateScanStatusRequest | undefined;
    if (!projectId?.trim() || !deviceId?.trim() || !scanId?.trim() || !body) {
      res.status(400).send();
      return;
    }

    const updated = await scanService.updateScanStatus(projectId, deviceId, scanId, body);
    if (!updated) {
      res.status(404).send();
      return;
    }

    const scan = await scanService.getScanRaw(projectId, deviceId, scanId);
    await scanService.tryIngestFromScanDocument(scan);

    if (body.Status?.trim().toLowerCase() === "complete") {
      const initiatedBy = typeof scan?.InitiatedByUserId === "string" ? scan.InitiatedByUserId : null;
      if (initiatedBy?.trim()) {
        scanService.notifyScanCompleted(initiatedBy, projectId);
      }
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

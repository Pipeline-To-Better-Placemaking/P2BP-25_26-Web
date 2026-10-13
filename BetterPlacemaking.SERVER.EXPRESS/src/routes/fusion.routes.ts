import { Router } from "express";
import type { Request, Response } from "express";
import * as fusionService from "../services/fusionService.js";
import { downloadStorageBytes } from "../services/fusionEngineService.js";
import { hasProjectPermission } from "../authorization/authorizationService.js";
import { Permissions } from "../authorization/permissions.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import type { FusionRun, TriggerFusionDto, UpdateFusionConfigDto } from "../models/fusion.js";

/**
 * Ported from BetterPlacemaking.SERVER/Controllers/FusionController.cs. Matches the endpoint
 * contract BetterPlacemaking.CLIENT.REACT/src/services/fusionApi.ts already expects exactly:
 *
 *   GET    /api/fusion/history?projectId=&limit=   -> FusionRunDto[]
 *   POST   /api/fusion/trigger?projectId=           -> FusionRunDto
 *   DELETE /api/fusion/:runId                       -> 204
 *   POST   /api/fusion/:runId/cancel                -> { status }
 *   GET    /api/fusion/:runId/download-url          -> { url }
 *   GET    /api/fusion/:runId/download              -> binary (fused_tracks.json)
 *   GET    /api/fusion/config?projectId=             -> FusionConfigDto
 *   PUT    /api/fusion/config?projectId=             -> FusionConfigDto
 *
 * Not wired into app.ts yet (another migration step mounts it, same as scanRouter/
 * scanScheduleRouter before it); intended mount point is `/api/fusion`.
 *
 * Permission scoping mirrors the two patterns FusionController.cs used side-by-side:
 *  - history/trigger/config: [RequirePermission] resolved from the `projectId` query param -
 *    handled by the requirePermission middleware below, same as scan.routes.ts/
 *    scanSchedule.routes.ts.
 *  - delete/cancel/download-url/download (runId-addressed, no projectId in the URL):
 *    GetAuthorizedRunAsync in the C# source loads the run first to discover ITS ProjectId, then
 *    checks the caller's permission on that project - ported below as getAuthorizedRun, since
 *    requirePermission's query/param-based projectId resolution doesn't apply to these routes.
 */
export const fusionRouter = Router();

fusionRouter.use(requireAuth);

/** Ported from FusionController.GetAuthorizedRunAsync. Loads the run, resolves its ProjectId,
 * and checks the caller's project permission - writing the appropriate error response and
 * returning null if any step fails, or the run if authorized. */
async function getAuthorizedRun(req: Request, res: Response, runId: string, permission: string): Promise<FusionRun | null> {
  if (!runId?.trim()) {
    res.status(400).json("runId required.");
    return null;
  }

  const run = await fusionService.getRun(runId);
  if (!run) {
    res.status(404).send();
    return null;
  }

  if (!run.ProjectId || !run.ProjectId.trim()) {
    res.status(403).send();
    return null;
  }

  const userId = req.user?.sub;
  if (!userId) {
    res.status(401).send();
    return null;
  }

  const allowed = await hasProjectPermission(userId, req.user?.role, run.ProjectId, permission);
  if (!allowed) {
    res.status(403).send();
    return null;
  }

  return run;
}

// ── History ──────────────────────────────────────────────────────────────

fusionRouter.get("/history", requirePermission(Permissions.Project.ScansRead), async (req, res, next) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId?.trim()) {
      res.status(400).json("projectId required.");
      return;
    }

    const rawLimit = req.query.limit ? Number(req.query.limit) : 50;
    const limit = Number.isFinite(rawLimit) ? rawLimit : 50;

    const history = await fusionService.getHistory(projectId, limit);
    res.status(200).json(history);
  } catch (err) {
    next(err);
  }
});

// ── Trigger ──────────────────────────────────────────────────────────────

fusionRouter.post("/trigger", requirePermission(Permissions.Project.ScansStart), async (req, res, next) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId?.trim()) {
      res.status(400).json("projectId required.");
      return;
    }

    const dto = req.body as TriggerFusionDto | undefined;
    if (!dto) {
      res.status(400).json("Invalid payload.");
      return;
    }
    if (dto.FromDateUnix >= dto.ToDateUnix) {
      res.status(400).json("From must be before To.");
      return;
    }

    // Matches FusionController.TriggerFusion: the projectId used is the query param, not
    // dto.ProjectId (the body's ProjectId field is otherwise unused for this call).
    const run = await fusionService.triggerFusion(dto.FromDateUnix, dto.ToDateUnix, "manual", projectId);
    res.status(200).json(run);
  } catch (err) {
    next(err);
  }
});

// ── Delete a run ─────────────────────────────────────────────────────────

fusionRouter.delete("/:runId", async (req, res, next) => {
  try {
    const run = await getAuthorizedRun(req, res, req.params.runId, Permissions.Project.ScansDelete);
    if (!run) return;

    await fusionService.deleteRun(run.Id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── Cancel a run ─────────────────────────────────────────────────────────

fusionRouter.post("/:runId/cancel", async (req, res, next) => {
  try {
    const run = await getAuthorizedRun(req, res, req.params.runId, Permissions.Project.ScansStart);
    if (!run) return;

    const result = await fusionService.cancelRun(run.Id);
    switch (result) {
      case "cancelling":
        res.status(202).json({ status: "cancelling" });
        return;
      case "stale":
        res.status(200).json({ status: "cancelled" });
        return;
      case "not_running":
        res.status(409).json({ error: "Run is not in a running state" });
        return;
      case "not_found":
        res.status(404).send();
        return;
      default:
        res.status(500).send();
        return;
    }
  } catch (err) {
    next(err);
  }
});

// ── Signed download URL ──────────────────────────────────────────────────

fusionRouter.get("/:runId/download-url", async (req, res, next) => {
  try {
    const run = await getAuthorizedRun(req, res, req.params.runId, Permissions.Project.Export);
    if (!run) return;

    const url = await fusionService.getDownloadUrl(run.Id);
    if (!url) {
      res.status(404).json("No output file for this run.");
      return;
    }
    res.status(200).json({ url });
  } catch (err) {
    next(err);
  }
});

// ── Direct binary download ───────────────────────────────────────────────

fusionRouter.get("/:runId/download", async (req, res, next) => {
  try {
    const run = await getAuthorizedRun(req, res, req.params.runId, Permissions.Project.Export);
    if (!run) return;

    if (!run.OutputGcsPath || !run.OutputGcsPath.trim()) {
      res.status(404).send();
      return;
    }

    const bytes = await downloadStorageBytes(run.OutputGcsPath);
    const filename = run.OutputGcsPath.split("/").pop() ?? "fused_tracks.json";
    res.status(200).type("application/json").attachment(filename).send(bytes);
  } catch (err) {
    next(err);
  }
});

// ── Config ───────────────────────────────────────────────────────────────

fusionRouter.get("/config", requirePermission(Permissions.Project.ScanSchedulesRead), async (req, res, next) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId?.trim()) {
      res.status(400).json("projectId required.");
      return;
    }

    const config = await fusionService.getConfig(projectId);
    res.status(200).json(config);
  } catch (err) {
    next(err);
  }
});

fusionRouter.put("/config", requirePermission(Permissions.Project.ScanSchedulesManage), async (req, res, next) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId?.trim()) {
      res.status(400).json("projectId required.");
      return;
    }

    const dto = req.body as UpdateFusionConfigDto | undefined;
    if (!dto) {
      res.status(400).json("Invalid payload.");
      return;
    }

    const config = await fusionService.updateConfig({ ...dto, ProjectId: projectId });
    res.status(200).json(config);
  } catch (err) {
    if (err instanceof fusionService.FusionConfigValidationError) {
      res.status(400).json(err.message);
      return;
    }
    next(err);
  }
});

import { Router } from "express";
import { Permissions } from "../authorization/permissions.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  amcWorkstationUrl,
  createProvisionTicket,
  createWorkstationTicket,
  isWorkstationControlConfigured,
} from "../services/workstationTicketService.js";
import {
  createCalibrationSpec,
  FloorplanNotInProjectError,
  ProjectNotFoundError,
  WorkstationFolderMissingError,
  type CalibrationSpec,
} from "../services/calibrationSpecService.js";

export const workstationRouter = Router();

workstationRouter.use(requireAuth);

type ParsedFloorplanId = { ok: true; value: string | undefined } | { ok: false };

//Optional body FloorplanId: absent or null picks the newest floor plan
function parseFloorplanId(body: unknown): ParsedFloorplanId {
  const raw = (body as { FloorplanId?: unknown } | undefined)?.FloorplanId;
  if (raw !== undefined && raw !== null && (typeof raw !== "string" || !raw.trim())) return { ok: false };
  return { ok: true, value: typeof raw === "string" ? raw.trim() : undefined };
}

function specSummary(spec: CalibrationSpec) {
  return {
    ProjectTitle: spec.title,
    FloorplanId: spec.floorplan?.id ?? null,
    FloorplanNickname: spec.floorplan?.nickname ?? null,
    LayoutPxPerM: spec.floorplan?.pxPerM ?? null,
    WorkstationFolder: spec.folder,
  };
}

//Hands a ticket to control the AMC
workstationRouter.post("/project/:projectId/ticket", requirePermission(Permissions.Project.VisionRead), (req, res, next) => {
  try {
    const workstationUrl = amcWorkstationUrl();
    if (!isWorkstationControlConfigured() || !workstationUrl) {
      res.status(503).json({ Message: "Workstation control is not configured." });
      return;
    }
    const { ticket, expiresAtUtc } = createWorkstationTicket(req.user!.sub, req.params.projectId);
    res.status(200).json({
      Ticket: ticket,
      ExpiresAt: expiresAtUtc.toISOString(),
      WorkstationUrl: workstationUrl,
    });
  } catch (err) {
    next(err);
  }
});

workstationRouter.post("/project/:projectId/calibration-spec", requirePermission(Permissions.Project.VisionRead), async (req, res, next) => {
  try {
    if (!isWorkstationControlConfigured()) {
      res.status(503).json({ Message: "Workstation control is not configured." });
      return;
    }
    const floorplanId = parseFloorplanId(req.body);
    if (!floorplanId.ok) {
      res.status(400).json({ Message: "FloorplanId must be a non-empty string." });
      return;
    }
    const { token, expiresAtUtc, spec } = await createCalibrationSpec(req.user!.sub, req.params.projectId, floorplanId.value);
    res.status(200).json({
      Spec: token,
      ExpiresAt: expiresAtUtc.toISOString(),
      Summary: specSummary(spec),
    });
  } catch (err) {
    if (err instanceof ProjectNotFoundError || err instanceof FloorplanNotInProjectError) {
      res.status(404).json({ Message: err.message });
      return;
    }
    next(err);
  }
});

//Hands a ticket and spec to create the project's folder and AMC project on the workstation
workstationRouter.post("/project/:projectId/provision", requirePermission(Permissions.Project.Update), async (req, res, next) => {
  try {
    const workstationUrl = amcWorkstationUrl();
    if (!isWorkstationControlConfigured() || !workstationUrl) {
      res.status(503).json({ Message: "Workstation control is not configured." });
      return;
    }
    const floorplanId = parseFloorplanId(req.body);
    if (!floorplanId.ok) {
      res.status(400).json({ Message: "FloorplanId must be a non-empty string." });
      return;
    }
    const created = await createCalibrationSpec(req.user!.sub, req.params.projectId, floorplanId.value, {
      requireFolder: true,
    });
    const { ticket, expiresAtUtc } = createProvisionTicket(req.user!.sub, req.params.projectId);
    const expiresAt = Math.min(expiresAtUtc.getTime(), created.expiresAtUtc.getTime());
    res.status(200).json({
      Ticket: ticket,
      Spec: created.token,
      ExpiresAt: new Date(expiresAt).toISOString(),
      WorkstationUrl: workstationUrl,
    });
  } catch (err) {
    if (err instanceof ProjectNotFoundError || err instanceof FloorplanNotInProjectError) {
      res.status(404).json({ Message: err.message });
      return;
    }
    if (err instanceof WorkstationFolderMissingError) {
      res.status(400).json({ Message: err.message });
      return;
    }
    next(err);
  }
});

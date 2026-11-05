import { Router } from "express";
import { env } from "../config/env.js";
import { Permissions } from "../authorization/permissions.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { createWorkstationTicket, isWorkstationControlConfigured } from "../services/workstationTicketService.js";
import {
  createCalibrationSpec,
  FloorplanNotInProjectError,
  ProjectNotFoundError,
} from "../services/calibrationSpecService.js";

export const workstationRouter = Router();

workstationRouter.use(requireAuth);

//Hands a ticket to control the AMC
workstationRouter.post("/project/:projectId/ticket", requirePermission(Permissions.Project.VisionRead), (req, res, next) => {
  try {
    if (!isWorkstationControlConfigured()) {
      res.status(503).json({ Message: "Workstation control is not configured." });
      return;
    }
    const { ticket, expiresAtUtc } = createWorkstationTicket(req.user!.sub, req.params.projectId);
    res.status(200).json({
      Ticket: ticket,
      ExpiresAt: expiresAtUtc.toISOString(),
      WorkstationUrl: (env.workstationBaseUrl as string).replace(/\/+$/, ""),
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
      const raw = (req.body as { FloorplanId?: unknown } | undefined)?.FloorplanId;
      if (raw !== undefined && raw !== null && (typeof raw !== "string" || !raw.trim())) {
        res.status(400).json({ Message: "FloorplanId must be a non-empty string." });
        return;
      }
      const floorplanId = typeof raw === "string" ? raw.trim() : undefined;
      const { token, expiresAtUtc, spec } = await createCalibrationSpec(req.user!.sub, req.params.projectId, floorplanId);
      res.status(200).json({
        Spec: token,
        ExpiresAt: expiresAtUtc.toISOString(),
        Summary: {
          ProjectTitle: spec.title,
          FloorplanId: spec.floorplan?.id ?? null,
          FloorplanNickname: spec.floorplan?.nickname ?? null,
          LayoutPxPerM: spec.floorplan?.pxPerM ?? null,
        },
      });
    } catch (err) {
      if (err instanceof ProjectNotFoundError || err instanceof FloorplanNotInProjectError) {
        res.status(404).json({ Message: err.message });
        return;
      }
      next(err);
    }
  },
);

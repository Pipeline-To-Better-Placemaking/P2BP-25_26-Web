import { Router } from "express";
import { env } from "../config/env.js";
import { Permissions } from "../authorization/permissions.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { createWorkstationTicket, isWorkstationControlConfigured } from "../services/workstationTicketService.js";

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

import { Router, type NextFunction, type Request, type Response } from "express";
import { Permissions } from "../authorization/permissions.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  createTrackingTicket,
  isTrackingTicketConfigured,
  trackingWorkstationUrl,
} from "../services/trackingTicketService.js";

export const TRACKING_TICKET_RATE_WINDOW_MS = 60_000;

// Per-user limit: one ticket per window. The client caches the ticket until it
// expires, so this only bites a misbehaving client. It runs before the permission
// check so repeated calls cost no database lookups. In-memory per instance, which
// is enough to stop a single tab from hammering the free tier.
const lastIssuedAt = new Map<string, number>();
let now: () => number = Date.now;

/** Test hook: clears the limiter and optionally swaps the clock. */
export function resetTrackingTicketRateLimit(clock: () => number = Date.now): void {
  lastIssuedAt.clear();
  now = clock;
}

function rateLimitPerUser(req: Request, res: Response, next: NextFunction): void {
  const userId = req.user!.sub;
  const t = now();

  for (const [id, at] of lastIssuedAt) {
    if (t - at >= TRACKING_TICKET_RATE_WINDOW_MS) lastIssuedAt.delete(id);
  }

  const previous = lastIssuedAt.get(userId);
  if (previous !== undefined) {
    const retryAfterSeconds = Math.max(1, Math.ceil((previous + TRACKING_TICKET_RATE_WINDOW_MS - t) / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({ Message: "Too many ticket requests.", RetryAfterSeconds: retryAfterSeconds });
    return;
  }

  lastIssuedAt.set(userId, t);
  next();
}

export const trackingTicketRouter = Router();

trackingTicketRouter.use(requireAuth);

trackingTicketRouter.post(
  "/project/:projectId/ticket",
  rateLimitPerUser,
  requirePermission(Permissions.Project.ScansRead),
  (req, res, next) => {
    try {
      const workstationUrl = trackingWorkstationUrl();
      if (!isTrackingTicketConfigured() || !workstationUrl) {
        res.status(503).json({ Message: "Workstation tracking is not configured." });
        return;
      }

      const { ticket, expiresAtUtc } = createTrackingTicket(req.user!, req.params.projectId);
      res.status(200).json({
        Ticket: ticket,
        ExpiresAt: expiresAtUtc.toISOString(),
        WorkstationUrl: workstationUrl,
      });
    } catch (err) {
      next(err);
    }
  },
);

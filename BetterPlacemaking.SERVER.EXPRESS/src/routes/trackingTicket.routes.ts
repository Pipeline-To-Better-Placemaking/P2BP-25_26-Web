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
export const TRACKING_TICKET_FAILED_WINDOW_MS = 5_000;

// Per-user limit. A request that ends in a ticket (200) blocks the next one for
// 60 s; the client caches the ticket until it expires, so this only bites a
// misbehaving client. Any other outcome (403, 503, error) blocks for only 5 s,
// so a user can still switch to a project they can read. The check runs before
// the permission check so repeated calls cost no database lookups. In-memory per
// instance, which is enough to stop a single tab from hammering the free tier.
interface Attempt {
  at: number;
  windowMs: number;
}

const attempts = new Map<string, Attempt>();
let now: () => number = Date.now;

/** Test hook: clears the limiter and optionally swaps the clock. */
export function resetTrackingTicketRateLimit(clock: () => number = Date.now): void {
  attempts.clear();
  now = clock;
}

function rateLimitPerUser(req: Request, res: Response, next: NextFunction): void {
  const userId = req.user!.sub;
  const t = now();

  for (const [id, a] of attempts) {
    if (t - a.at >= a.windowMs) attempts.delete(id);
  }

  const previous = attempts.get(userId);
  if (previous) {
    const retryAfterSeconds = Math.max(1, Math.ceil((previous.at + previous.windowMs - t) / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({ Message: "Too many ticket requests.", RetryAfterSeconds: retryAfterSeconds });
    return;
  }

  // Start with the short window (covers concurrent requests and requests that
  // never finish), then widen it once the response is known to be a ticket.
  const attempt: Attempt = { at: t, windowMs: TRACKING_TICKET_FAILED_WINDOW_MS };
  attempts.set(userId, attempt);
  res.on("finish", () => {
    if (res.statusCode === 200) attempt.windowMs = TRACKING_TICKET_RATE_WINDOW_MS;
  });
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

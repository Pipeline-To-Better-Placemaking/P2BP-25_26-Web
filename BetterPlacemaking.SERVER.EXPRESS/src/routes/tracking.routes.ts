import { Router } from "express";
import * as trackingService from "../services/trackingService.js";
import { requireAuth } from "../middleware/requireAuth.js";

/**
 * Ported from BetterPlacemaking.SERVER/Controllers/TrackingController.cs.
 * That controller only carries the class-level [Authorize(Policy = "UserJwt")] -
 * no [RequirePermission(...)] on any action - so every route below is
 * authenticated-only, same as the original (ported faithfully, not a gap).
 */
export const trackingRouter = Router();

trackingRouter.use(requireAuth);

trackingRouter.get("/positions", async (req, res, next) => {
  try {
    const rawLimit = req.query.limit;
    const limit = rawLimit !== undefined ? Number.parseInt(String(rawLimit), 10) : 1000;
    const positions = await trackingService.getRecentPositions(Number.isFinite(limit) ? limit : 1000);
    res.status(200).json(positions);
  } catch (err) {
    next(err);
  }
});

trackingRouter.get("/tracks", async (_req, res, next) => {
  try {
    const tracks = await trackingService.getAllTracks();
    res.status(200).json(tracks);
  } catch (err) {
    next(err);
  }
});

// Matches TrackingController's {globalId:int} route constraint: a non-integer
// segment doesn't match this route at all (plain 404), which is distinct from
// a valid-but-unknown id (404 with an error body) below.
trackingRouter.get("/tracks/:globalId", async (req, res, next) => {
  try {
    if (!/^-?\d+$/.test(req.params.globalId)) {
      res.status(404).send();
      return;
    }
    const globalId = Number.parseInt(req.params.globalId, 10);
    const track = await trackingService.getTrackByGlobalId(globalId);
    if (!track) {
      res.status(404).json({ error: `Track with global ID ${globalId} not found` });
      return;
    }
    res.status(200).json(track);
  } catch (err) {
    next(err);
  }
});

trackingRouter.get("/active", async (req, res, next) => {
  try {
    const rawSeconds = req.query.seconds;
    const seconds = rawSeconds !== undefined ? Number.parseInt(String(rawSeconds), 10) : 30;
    const active = await trackingService.getActiveTracks(Number.isFinite(seconds) ? seconds : 30);
    res.status(200).json(active);
  } catch (err) {
    next(err);
  }
});

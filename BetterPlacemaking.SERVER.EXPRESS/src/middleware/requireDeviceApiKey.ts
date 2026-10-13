import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { devices } from "../db/schema/index.js";
import { toDevice } from "../services/deviceService.js";
import type { Device } from "../models/device.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      device?: Device;
    }
  }
}

export function computeApiKeyHash(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("base64");
}

/**
 * Mirrors DeviceApiKeyAuthenticationHandler / the "DeviceApiKey" auth policy -
 * authenticates a device via `Authorization: Bearer <raw api key>`, matched
 * against the stored ApiKeyHash (see deviceService.generateAndUpdateApiKey).
 * The distributed-cache layer in front of this lookup in the ASP.NET
 * DeviceService is not ported - every request does a direct DB query,
 * same as every other resource ported so far.
 */
export async function requireDeviceApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ Message: "Missing device API key." });
    return;
  }

  const apiKey = header.slice("Bearer ".length).trim();
  if (!apiKey) {
    res.status(401).json({ Message: "Missing device API key." });
    return;
  }

  try {
    const hash = computeApiKeyHash(apiKey);
    const [row] = await getDb().select().from(devices).where(eq(devices.apiKeyHash, hash)).limit(1);
    if (!row) {
      res.status(401).json({ Message: "Invalid device API key." });
      return;
    }

    req.device = toDevice(row);
    next();
  } catch (err) {
    next(err);
  }
}

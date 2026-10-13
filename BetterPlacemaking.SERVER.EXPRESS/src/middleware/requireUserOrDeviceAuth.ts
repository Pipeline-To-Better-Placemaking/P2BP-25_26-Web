import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { devices } from "../db/schema/index.js";
import { toDevice } from "../services/deviceService.js";
import { verifyUserToken } from "../services/tokenService.js";
import { computeApiKeyHash } from "./requireDeviceApiKey.js";

/**
 * Matches CloudStorageController: [Authorize(AuthenticationSchemes = "UserJwt,DeviceApiKey")] -
 * accepts either a user JWT or a device API key in the same `Authorization: Bearer` header, so
 * both logged-in users and Jetson devices can request their own signed GCS URLs. Tries the
 * (cheap, local) JWT verification first and only falls back to a device-key lookup
 * if that fails, rather than picking a scheme up front - same "try both" semantics ASP.NET's
 * multi-scheme [Authorize] gives you.
 */
export async function requireUserOrDeviceAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ Message: "Missing bearer token." });
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    res.status(401).json({ Message: "Missing bearer token." });
    return;
  }

  try {
    req.user = verifyUserToken(token);
    next();
    return;
  } catch {
    // Not a valid user JWT - fall through and try it as a device API key.
  }

  try {
    const hash = computeApiKeyHash(token);
    const [row] = await getDb().select().from(devices).where(eq(devices.apiKeyHash, hash)).limit(1);
    if (!row) {
      res.status(401).json({ Message: "Invalid or expired token." });
      return;
    }

    req.device = toDevice(row);
    next();
  } catch (err) {
    next(err);
  }
}

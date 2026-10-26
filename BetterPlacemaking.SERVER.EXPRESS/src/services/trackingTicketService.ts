import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { JwtClaims } from "../models/types.js";

// Short-lived ticket the browser presents directly to the workstation's tracking
// history API. The workstation verifies it with the same shared secret; this
// server never proxies tracking data.
export const TRACKING_TICKET_AUDIENCE = "p2bp-workstation";
export const TRACKING_TICKET_SCOPE = "tracking";

export interface TrackingTicketClaims {
  sub: string;
  pid: string;
  scope: typeof TRACKING_TICKET_SCOPE;
  name: string;
}

export interface CreatedTrackingTicket {
  ticket: string;
  expiresAtUtc: Date;
}

export function isTrackingTicketConfigured(): boolean {
  return !!env.workstationTicketSecret && !!env.workstationTrackingUrl;
}

/** Workstation base URL with trailing slashes removed, or undefined if unset. */
export function trackingWorkstationUrl(): string | undefined {
  return env.workstationTrackingUrl?.replace(/\/+$/, "");
}

/** Display name shown by the workstation lock ("in use by ..."). */
function displayName(user: JwtClaims): string {
  return user.name?.trim() || user.email?.trim() || user.sub;
}

export function createTrackingTicket(user: JwtClaims, projectId: string): CreatedTrackingTicket {
  const secret = env.workstationTicketSecret;
  if (!secret) {
    throw new Error("WORKSTATION_TICKET_SECRET is not configured.");
  }

  const minutes = env.workstationTicketMinutes;
  const expiresAtUtc = new Date(Date.now() + minutes * 60_000);

  const claims: TrackingTicketClaims = {
    sub: user.sub,
    pid: projectId,
    scope: TRACKING_TICKET_SCOPE,
    name: displayName(user),
  };

  const ticket = jwt.sign(claims, secret, {
    algorithm: "HS256",
    audience: TRACKING_TICKET_AUDIENCE,
    issuer: env.jwtIssuer,
    expiresIn: `${minutes}m`,
  });

  return { ticket, expiresAtUtc };
}

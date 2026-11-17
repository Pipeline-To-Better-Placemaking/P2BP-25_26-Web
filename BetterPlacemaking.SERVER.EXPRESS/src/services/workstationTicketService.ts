import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

// Short-lived ticket the browser presents directly to the workstation's AMC
// control service (start/stop/status). It is signed with the same secret as the
// tracking ticket (trackingTicketService.ts); the scope claim is what tells the
// two apart, so the workstation must check it.
export const WORKSTATION_TICKET_AUDIENCE = "p2bp-workstation";
export const WORKSTATION_TICKET_SCOPE = "amc";

export interface WorkstationTicket {
  ticket: string;
  expiresAtUtc: Date;
}

export function isWorkstationControlConfigured(): boolean {
  return !!env.workstationTicketSecret && !!env.workstationAmcUrl;
}

/** AMC control service base URL with trailing slashes removed, or undefined if unset. */
export function amcWorkstationUrl(): string | undefined {
  return env.workstationAmcUrl?.replace(/\/+$/, "");
}

export function createWorkstationTicket(userId: string, projectId: string): WorkstationTicket {
  const secret = env.workstationTicketSecret;
  if (!secret) throw new Error("WORKSTATION_TICKET_SECRET is not configured.");

  const minutes = env.workstationAmcTicketMinutes;
  const expiresAtUtc = new Date(Date.now() + minutes * 60_000);
  const ticket = jwt.sign({ sub: userId, pid: projectId, scope: WORKSTATION_TICKET_SCOPE }, secret, {
    algorithm: "HS256",
    audience: WORKSTATION_TICKET_AUDIENCE,
    issuer: env.jwtIssuer,
    expiresIn: `${minutes}m`,
  });
  return { ticket, expiresAtUtc };
}

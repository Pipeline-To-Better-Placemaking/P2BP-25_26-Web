import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

// Short-lived ticket the browser presents directly to the workstation's AMC
// control service (start/stop/status). It is signed with the same secret as the
// tracking ticket (trackingTicketService.ts); the scope claim is what tells the
// two apart, so the workstation must check it.
export const WORKSTATION_TICKET_AUDIENCE = "p2bp-workstation";
export const WORKSTATION_TICKET_SCOPE = "amc";
// Ticket for POST /projects on the workstation: creates the project's folder and
// AMC project (hardware repo `installer/plan/AMC-WEB-PROJECTS.md`, section 9).
export const WORKSTATION_PROVISION_TICKET_SCOPE = "amc-provision";
export const WORKSTATION_PROVISION_TICKET_MINUTES = 15;

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

function signWorkstationTicket(userId: string, projectId: string, scope: string, minutes: number): WorkstationTicket {
  const secret = env.workstationTicketSecret;
  if (!secret) throw new Error("WORKSTATION_TICKET_SECRET is not configured.");

  const expiresAtUtc = new Date(Date.now() + minutes * 60_000);
  const ticket = jwt.sign({ sub: userId, pid: projectId, scope }, secret, {
    algorithm: "HS256",
    audience: WORKSTATION_TICKET_AUDIENCE,
    issuer: env.jwtIssuer,
    expiresIn: `${minutes}m`,
  });
  return { ticket, expiresAtUtc };
}

export function createWorkstationTicket(userId: string, projectId: string): WorkstationTicket {
  return signWorkstationTicket(userId, projectId, WORKSTATION_TICKET_SCOPE, env.workstationAmcTicketMinutes);
}

export function createProvisionTicket(userId: string, projectId: string): WorkstationTicket {
  return signWorkstationTicket(
    userId,
    projectId,
    WORKSTATION_PROVISION_TICKET_SCOPE,
    WORKSTATION_PROVISION_TICKET_MINUTES,
  );
}

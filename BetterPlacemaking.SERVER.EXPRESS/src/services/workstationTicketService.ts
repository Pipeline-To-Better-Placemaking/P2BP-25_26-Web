import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const WORKSTATION_TICKET_AUDIENCE = "p2bp-workstation";
export const WORKSTATION_TICKET_SCOPE = "amc";

export interface WorkstationTicket {
  ticket: string;
  expiresAtUtc: Date;
}

export function isWorkstationControlConfigured(): boolean {
  return !!env.workstationTicketSecret && !!env.workstationBaseUrl;
}

export function createWorkstationTicket(userId: string, projectId: string): WorkstationTicket {
  const secret = env.workstationTicketSecret;
  if (!secret) throw new Error("WORKSTATION_TICKET_SECRET is not configured.");

  const minutes = env.workstationTicketMinutes;
  const expiresAtUtc = new Date(Date.now() + minutes * 60_000);
  const ticket = jwt.sign({ sub: userId, pid: projectId, scope: WORKSTATION_TICKET_SCOPE }, secret, {
    algorithm: "HS256",
    audience: WORKSTATION_TICKET_AUDIENCE,
    issuer: env.jwtIssuer,
    expiresIn: `${minutes}m`,
  });
  return { ticket, expiresAtUtc };
}

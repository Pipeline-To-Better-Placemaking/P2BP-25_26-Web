import { api, ApiError } from "../../../auth/apiClient";

//Client for controlling the AMC on the workstation

export type AmcState = "down" | "starting" | "ready" | "stopping" | "error";

export interface AmcStatus {
  State: AmcState;
  UiUrl: string;
  Error: string;
  UpdatedAt: number;
}

export interface WorkstationTicket {
  Ticket: string;
  ExpiresAt: string;
  WorkstationUrl: string;
}

export type WorkstationErrorKind = "unreachable" | "unauthorized" | "forbidden" | "server";

export class WorkstationError extends Error {
  kind: WorkstationErrorKind;
  status?: number;

  constructor(kind: WorkstationErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export function normalizeAmcUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `http://${text}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

//Checks if https is being mixed with http content
export function isMixedContent(url: string): boolean {
  return window.location.protocol === "https:" && url.startsWith("http:");
}

export function requestTicket(projectId: string): Promise<WorkstationTicket> {
  return api.post<WorkstationTicket>(`/api/workstation/project/${encodeURIComponent(projectId)}/ticket`);
}

// True if the server simply isn't set up for workstation control
export function isNotConfigured(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 503 || err.status === 404);
}

export async function amcRequest(
  baseUrl: string,
  ticket: string,
  path: "/amc/status" | "/amc/start" | "/amc/stop",
  method: "GET" | "POST",
): Promise<AmcStatus> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${ticket}` },
      cache: "no-store",
    });
  } catch {
    throw new WorkstationError("unreachable", "Can't reach the workstation service.");
  }

  if (res.status === 401) throw new WorkstationError("unauthorized", "The workstation rejected the ticket.", 401);
  if (res.status === 403) throw new WorkstationError("forbidden", "This workstation isn't set up for this project.", 403);
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
    }
    throw new WorkstationError("server", detail || `Workstation service error (${res.status}).`, res.status);
  }
  return (await res.json()) as AmcStatus;
}

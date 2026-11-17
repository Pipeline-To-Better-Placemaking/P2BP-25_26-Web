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

// Provision ticket (scope amc-provision) plus the signed spec that carries the folder
export interface ProvisionTicket extends WorkstationTicket {
  Spec: string;
}

export interface CalibrationSpecSummary {
  ProjectTitle: string;
  FloorplanId: string | null;
  FloorplanNickname: string | null;
  LayoutPxPerM: number | null;
  WorkstationFolder: string | null;
}

export interface CalibrationSpec {
  Spec: string;
  ExpiresAt: string;
  Summary: CalibrationSpecSummary;
}

export type WorkstationProjectState = "provisioning" | "ready" | "failed";

// The project's folder binding on the workstation; times are Unix seconds
export interface WorkstationProject {
  ProjectId: string;
  Folder: string;
  Title: string;
  AmcProjectId: string | null;
  AmcProjectName: string | null;
  State: WorkstationProjectState;
  Error: string;
  CreatedAt: number;
  UpdatedAt: number;
  LastRunAt: number | null;
  CalibRuns: number;
  Path: string;
}

export interface ProvisionResult {
  Binding: WorkstationProject;
  // The provision ticket; also accepted by GET /projects/current, so pass it to getWorkstationProject while polling
  Ticket: WorkstationTicket;
}

// One file in the project's folder; Path is relative with "/" separators, ModifiedAt is Unix seconds
export interface WorkstationFile {
  Path: string;
  Size: number;
  ModifiedAt: number;
}

export type AutomationStepState = "pending" | "running" | "done" | "skipped" | "waiting" | "failed";

export interface AutomationStep {
  Key: string;
  Number: number;
  Title: string;
  State: AutomationStepState;
  Message: string;
  Done: string;
  NeedsUser: boolean;
}

export type AutomationJobState =
  | "running"
  | "waiting_for_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface AutomationJob {
  JobId: string;
  ProjectId: string;
  ProjectTitle: string;
  State: AutomationJobState;
  Message: string;
  AmcProjectId: string;
  AmcProjectName: string;
  Steps: AutomationStep[];
  UserActions: string[];
  Result: Record<string, unknown>;
  StartedBy: string;
  StartedAt: number;
  UpdatedAt: number;
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

function projectPath(projectId: string): string {
  return `/api/workstation/project/${encodeURIComponent(projectId)}`;
}

export function requestTicket(projectId: string): Promise<WorkstationTicket> {
  return api.post<WorkstationTicket>(`${projectPath(projectId)}/ticket`);
}

// Needs Project.Update; 400 when the project has no workstation folder
export function requestProvisionTicket(projectId: string): Promise<ProvisionTicket> {
  return api.post<ProvisionTicket>(`${projectPath(projectId)}/provision`);
}

// FloorplanId omitted picks the project's newest floor plan
export function requestCalibrationSpec(projectId: string, floorplanId?: string): Promise<CalibrationSpec> {
  return api.post<CalibrationSpec>(
    `${projectPath(projectId)}/calibration-spec`,
    floorplanId ? { FloorplanId: floorplanId } : {},
  );
}

// True if the server simply isn't set up for workstation control
export function isNotConfigured(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 503 || err.status === 404);
}

// Readable message for a failure from either the web app server or the workstation
export function describeWorkstationError(err: unknown): string {
  if (err instanceof WorkstationError) return err.message;
  if (err instanceof ApiError) {
    if (err.status === 503) return "Workstation control is not configured on the server.";
    if (err.status === 403) return "You don't have permission for this on the project.";
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// Joins a path to the workstation base URL without doubling the slash
function workstationUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function workstationFetch<T>(
  baseUrl: string,
  ticket: string,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${ticket}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(workstationUrl(baseUrl, path), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new WorkstationError("unreachable", "Can't reach the workstation service.");
  }

  if (!res.ok) {
    let detail = "";
    try {
      const errBody = (await res.json()) as { detail?: unknown };
      if (typeof errBody.detail === "string") detail = errBody.detail;
    } catch {
    }
    if (res.status === 401) throw new WorkstationError("unauthorized", "The workstation rejected the ticket.", 401);
    if (res.status === 403) {
      throw new WorkstationError("forbidden", detail || "This workstation isn't set up for this project.", 403);
    }
    throw new WorkstationError("server", detail || `Workstation service error (${res.status}).`, res.status);
  }
  return (await res.json()) as T;
}

export function amcRequest(
  baseUrl: string,
  ticket: string,
  path: "/amc/status" | "/amc/start" | "/amc/stop",
  method: "GET" | "POST",
): Promise<AmcStatus> {
  return workstationFetch<AmcStatus>(baseUrl, ticket, path, method);
}

// -- amc tickets, cached per project until shortly before they expire --------

const TICKET_MARGIN_MS = 30_000;
const amcTickets = new Map<string, WorkstationTicket>();

function isFresh(ticket: WorkstationTicket): boolean {
  return Date.parse(ticket.ExpiresAt) - Date.now() > TICKET_MARGIN_MS;
}

async function amcTicket(projectId: string): Promise<WorkstationTicket> {
  const cached = amcTickets.get(projectId);
  if (cached && isFresh(cached)) return cached;
  const ticket = await requestTicket(projectId);
  amcTickets.set(projectId, ticket);
  return ticket;
}

// Runs a call with the project's amc ticket, fetching a new one once if the workstation rejects it
async function withAmcTicket<T>(projectId: string, call: (ticket: WorkstationTicket) => Promise<T>): Promise<T> {
  try {
    return await call(await amcTicket(projectId));
  } catch (err) {
    if (!(err instanceof WorkstationError && err.kind === "unauthorized")) throw err;
    amcTickets.delete(projectId);
    return call(await amcTicket(projectId));
  }
}

// -- project folder -----------------------------------------------------------

// Creates the project's folder and AMC project on the workstation (202 new, 200 already set up or in progress)
export async function provisionProject(projectId: string): Promise<ProvisionResult> {
  const provision = await requestProvisionTicket(projectId);
  const binding = await workstationFetch<WorkstationProject>(
    provision.WorkstationUrl,
    provision.Ticket,
    "/projects",
    "POST",
    { Spec: provision.Spec },
  );
  return {
    Binding: binding,
    Ticket: { Ticket: provision.Ticket, ExpiresAt: provision.ExpiresAt, WorkstationUrl: provision.WorkstationUrl },
  };
}

// The project's binding, or null when the workstation has no folder for it. Uses the given ticket
// (such as the provision ticket) while it is fresh, otherwise the project's amc ticket.
export async function getWorkstationProject(
  projectId: string,
  ticket?: WorkstationTicket,
): Promise<WorkstationProject | null> {
  const fetchCurrent = (t: WorkstationTicket) =>
    workstationFetch<WorkstationProject>(t.WorkstationUrl, t.Ticket, "/projects/current", "GET");
  try {
    if (ticket && isFresh(ticket)) return await fetchCurrent(ticket);
    return await withAmcTicket(projectId, fetchCurrent);
  } catch (err) {
    if (err instanceof WorkstationError && err.status === 404) return null;
    throw err;
  }
}

export function listProjectFiles(projectId: string): Promise<WorkstationFile[]> {
  return withAmcTicket(projectId, (t) =>
    workstationFetch<WorkstationFile[]>(t.WorkstationUrl, t.Ticket, "/projects/current/files", "GET"),
  );
}

// A listing's Path with each segment percent-encoded and "/" kept
export function encodeFilePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

// Plain download link for one file: carries the amc ticket as ?ticket= so the browser can stream it to disk
export function buildProjectFileUrl(baseUrl: string, ticket: string, path: string): string {
  return workstationUrl(
    baseUrl,
    `/projects/current/files/${encodeFilePath(path)}?ticket=${encodeURIComponent(ticket)}`,
  );
}

export async function projectFileUrl(projectId: string, path: string): Promise<string> {
  const t = await amcTicket(projectId);
  return buildProjectFileUrl(t.WorkstationUrl, t.Ticket, path);
}

// -- automated calibration runs ------------------------------------------------

// The current or last run, or null when there has been none
export function getAutomation(projectId: string): Promise<AutomationJob | null> {
  return withAmcTicket(projectId, (t) =>
    workstationFetch<AutomationJob | null>(t.WorkstationUrl, t.Ticket, "/amc/automation/status", "GET"),
  );
}

// Signs a calibration spec for the project (newest floor plan unless one is named) and starts a run with it
export async function startAutomation(projectId: string, floorplanId?: string): Promise<AutomationJob> {
  const spec = await requestCalibrationSpec(projectId, floorplanId);
  return withAmcTicket(projectId, (t) =>
    workstationFetch<AutomationJob>(t.WorkstationUrl, t.Ticket, "/amc/automation/start", "POST", { Spec: spec.Spec }),
  );
}

// After the manual steps, or to retry a failed step
export function continueAutomation(projectId: string): Promise<AutomationJob> {
  return withAmcTicket(projectId, (t) =>
    workstationFetch<AutomationJob>(t.WorkstationUrl, t.Ticket, "/amc/automation/continue", "POST"),
  );
}

export function cancelAutomation(projectId: string): Promise<AutomationJob> {
  return withAmcTicket(projectId, (t) =>
    workstationFetch<AutomationJob>(t.WorkstationUrl, t.Ticket, "/amc/automation/cancel", "POST"),
  );
}

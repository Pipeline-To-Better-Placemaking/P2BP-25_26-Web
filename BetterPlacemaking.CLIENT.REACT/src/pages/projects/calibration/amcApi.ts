import { api, ApiError } from "../../../auth/apiClient";
import * as authStore from "../../../auth/authStore";

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

// One file in the project's folder; Path is relative with "/" separators, ModifiedAt is Unix seconds.
// Downloadable is false for video files, which stay on the workstation; older workstations omit it.
export interface WorkstationFile {
  Path: string;
  Size: number;
  ModifiedAt: number;
  Downloadable?: boolean;
}

// What the workstation removed for DELETE /projects/current; Leftover is a renamed folder it could not remove
export interface WorkstationDeleteResult {
  Folder: string;
  AmcProjectId: string | null;
  AmcProjectDeleted: boolean;
  Leftover: string | null;
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
  // Seconds from a Retry-After header, when the response carried a readable one
  retryAfter?: number;

  constructor(kind: WorkstationErrorKind, message: string, status?: number, retryAfter?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// Retry-After as whole seconds; null when missing (or not exposed by CORS) or given as a date
export function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\s*\d+\s*$/.test(value)) return null;
  return Number(value.trim());
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

// Needs Project.Delete; scope amc-delete, only accepted by DELETE /projects/current
export function requestDeleteTicket(projectId: string): Promise<WorkstationTicket> {
  return api.post<WorkstationTicket>(`${projectPath(projectId)}/delete-ticket`);
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
  method: "GET" | "POST" | "DELETE",
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
    throw new WorkstationError(
      "server",
      detail || `Workstation service error (${res.status}).`,
      res.status,
      parseRetryAfter(res.headers.get("Retry-After")) ?? undefined,
    );
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
let ticketsUserId: string | null = null;

// Tickets belong to the user who asked for them: drop them all whenever the signed-in user changes
authStore.subscribe((state) => {
  const userId = state?.User.Id ?? null;
  if (userId !== ticketsUserId) {
    ticketsUserId = userId;
    amcTickets.clear();
  }
});

function isFresh(ticket: WorkstationTicket): boolean {
  return Date.parse(ticket.ExpiresAt) - Date.now() > TICKET_MARGIN_MS;
}

// Cache key: the signed-in user and the project, so a ticket is never reused by another user
function ticketKey(projectId: string): string {
  return `${authStore.getState()?.User.Id ?? ""}:${projectId}`;
}

async function amcTicket(projectId: string): Promise<WorkstationTicket> {
  const key = ticketKey(projectId);
  const cached = amcTickets.get(key);
  if (cached && isFresh(cached)) return cached;
  const ticket = await requestTicket(projectId);
  // Skip caching if the user changed while the request was in flight
  if (ticketKey(projectId) === key) amcTickets.set(key, ticket);
  return ticket;
}

// Runs a call with the project's amc ticket, fetching a new one once if the workstation rejects it
async function withAmcTicket<T>(projectId: string, call: (ticket: WorkstationTicket) => Promise<T>): Promise<T> {
  try {
    return await call(await amcTicket(projectId));
  } catch (err) {
    if (!(err instanceof WorkstationError && err.kind === "unauthorized")) throw err;
    forgetTicket(projectId);
    return call(await amcTicket(projectId));
  }
}

// Drops the cached amc ticket for the project, such as after its folder is deleted
function forgetTicket(projectId: string): void {
  amcTickets.delete(ticketKey(projectId));
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

// True when a workstation delete failed only because the workstation has no folder for the project
export function isAlreadyDeleted(err: unknown): boolean {
  return err instanceof WorkstationError && err.status === 404;
}

// How long a delete keeps retrying while the workstation starts AMC, and the wait when a 503
// carries no readable Retry-After (older workstations don't expose it through CORS)
export const AMC_START_WAIT_MS = 180_000;
export const DEFAULT_RETRY_AFTER_S = 15;

export interface DeleteWorkstationOptions {
  // Called before each wait while the workstation starts AMC, with the seconds until the retry
  onStartingAmc?: (retryInSeconds: number) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

// Deletes the project's folder and AMC project on the workstation. Resolves null when the workstation
// has no folder for the project, which leaves nothing to clean up. A 503 means the workstation is
// starting AMC: the call waits and retries for up to AMC_START_WAIT_MS.
export async function deleteWorkstationProject(
  projectId: string,
  options: DeleteWorkstationOptions = {},
): Promise<WorkstationDeleteResult | null> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;

  const ticket = await requestDeleteTicket(projectId);
  if (isMixedContent(ticket.WorkstationUrl)) {
    throw new WorkstationError(
      "unreachable",
      `This page is served over HTTPS but the workstation is at ${ticket.WorkstationUrl}, so the browser blocks the connection.`,
    );
  }

  const deadline = now() + AMC_START_WAIT_MS;
  let result: WorkstationDeleteResult | null;
  for (;;) {
    try {
      result = await workstationFetch<WorkstationDeleteResult>(
        ticket.WorkstationUrl,
        ticket.Ticket,
        "/projects/current",
        "DELETE",
      );
      break;
    } catch (err) {
      if (isAlreadyDeleted(err)) {
        result = null;
        break;
      }
      if (!(err instanceof WorkstationError && err.status === 503)) throw err;
      const remaining = deadline - now();
      if (remaining <= 0) {
        throw new WorkstationError(
          "server",
          "AMC did not become ready on the workstation within three minutes.",
          503,
        );
      }
      const waitS = err.retryAfter ?? DEFAULT_RETRY_AFTER_S;
      options.onStartingAmc?.(waitS);
      await sleep(Math.min(waitS * 1000, remaining));
    }
  }
  forgetTicket(projectId);
  return result;
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
    if (ticket && isFresh(ticket)) {
      try {
        return await fetchCurrent(ticket);
      } catch (err) {
        // A rejected provision ticket falls back to the project's amc ticket once
        if (!(err instanceof WorkstationError && err.kind === "unauthorized")) throw err;
      }
    }
    return await withAmcTicket(projectId, fetchCurrent);
  } catch (err) {
    if (err instanceof WorkstationError && err.status === 404) return null;
    throw err;
  }
}

// Video files stay on the workstation: anything under footage/ or with one of these suffixes
const VIDEO_SUFFIXES = [".mp4", ".mkv", ".mov", ".avi", ".ts", ".h264", ".h265"];

export function isVideoPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.startsWith("footage/") || VIDEO_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

// Honors the workstation's Downloadable flag, falling back to the video rule when it is missing
export function isDownloadable(file: WorkstationFile): boolean {
  return file.Downloadable ?? !isVideoPath(file.Path);
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

export interface StartAutomationOptions {
  // Records new footage from every camera in step 2 for this many seconds (the workstation accepts 30 to 1800)
  recordSeconds?: number;
}

// Signs a calibration spec for the project (newest floor plan unless one is named) and starts a run with it
export async function startAutomation(
  projectId: string,
  floorplanId?: string,
  options?: StartAutomationOptions,
): Promise<AutomationJob> {
  const spec = await requestCalibrationSpec(projectId, floorplanId);
  const recordSeconds = options?.recordSeconds;
  const body =
    recordSeconds !== undefined ? { Spec: spec.Spec, Record: { Seconds: recordSeconds } } : { Spec: spec.Spec };
  return withAmcTicket(projectId, (t) =>
    workstationFetch<AutomationJob>(t.WorkstationUrl, t.Ticket, "/amc/automation/start", "POST", body),
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

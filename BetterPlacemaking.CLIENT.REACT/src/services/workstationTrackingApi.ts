import { api, ApiError } from "../auth/apiClient";
import * as authStore from "../auth/authStore";
import type { StoredAuth } from "../lib/types";
import type {
  Matrix3,
  TrackingCamera,
  TrackingExportFormat,
  TrackingFloorplan,
  TrackingHeartbeatDto,
  TrackingMeta,
  TrackingMode,
  TrackingPerson,
  TrackingRange,
  TrackingRangeQuery,
  TrackingSessionDto,
  TrackingSessionKind,
  TrackingTicketDto,
} from "../lib/trackingTypes";

/**
 * Tracking history lives on the workstation, not in Express/Supabase. Express only mints a
 * short-lived project-scoped ticket; every data request goes straight from the browser to the
 * workstation over the tailnet with `Authorization: Bearer <ticket>`.
 *
 * The ticket route allows one mint per 60 s per user, so tickets are cached per user and project
 * and reused until 30 s before they expire, and a new mint is never attempted within 60 s of the
 * previous one. The cache is cleared whenever the signed-in user changes.
 *
 * The workstation allows one data request (range or export) in flight per lease, so those go
 * through a client-side queue. Heartbeats, session calls, meta and the floor plan are not queued,
 * so a long export can never starve the lease.
 */

const TICKET_REFRESH_MARGIN_MS = 30_000;
const TICKET_MIN_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export class TrackingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TrackingError";
    this.status = status;
  }
}

/** Another user holds the data lease (423), or our lease is gone. */
export class TrackingLockedError extends TrackingError {
  heldBy: string | null;
  until: number | null;
  constructor(heldBy: string | null, until: number | null, message?: string) {
    super(423, message ?? (heldBy ? `In use by ${heldBy}.` : "The tracking data session is no longer valid."));
    this.name = "TrackingLockedError";
    this.heldBy = heldBy;
    this.until = until;
  }
}

export class TrackingRateLimitedError extends TrackingError {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message?: string) {
    super(429, message ?? `Too many requests. Try again in ${retryAfterSeconds} s.`);
    this.name = "TrackingRateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** fetch() itself failed: device not on the tailnet, or the workstation is offline. */
export class TrackingUnreachableError extends TrackingError {
  constructor() {
    super(
      0,
      "Can't reach the workstation. This device must be connected to the tailnet (Tailscale), and the workstation must be online.",
    );
    this.name = "TrackingUnreachableError";
  }
}

/** Express has no workstation configured (503). */
export class TrackingNotConfiguredError extends TrackingError {
  constructor(message?: string) {
    super(503, message || "Workstation tracking is not configured on the server.");
    this.name = "TrackingNotConfiguredError";
  }
}

// ---------------------------------------------------------------------------------------------
// Ticket cache
// ---------------------------------------------------------------------------------------------

interface CachedTicket {
  ticket: string;
  expiresAtMs: number;
  baseUrl: string;
}

const ticketCache = new Map<string, CachedTicket>();
const lastMintAt = new Map<string, number>();
const inflightTickets = new Map<string, Promise<CachedTicket>>();

function userKeyOf(state: StoredAuth | null): string {
  return state?.User?.Id || state?.User?.Email || "anonymous";
}

let currentUserKey = userKeyOf(authStore.getState());
authStore.subscribe((state) => {
  const next = userKeyOf(state);
  if (next === currentUserKey) return;
  currentUserKey = next;
  ticketCache.clear();
  lastMintAt.clear();
  inflightTickets.clear();
});

/** Cache key: tickets are bound to both the signed-in user and the project. */
function cacheKey(projectId: string): string {
  return `${userKeyOf(authStore.getState())}|${projectId}`;
}

function isFresh(t: CachedTicket | undefined, now = Date.now()): t is CachedTicket {
  return !!t && t.expiresAtMs - TICKET_REFRESH_MARGIN_MS > now;
}

function messageOf(body: unknown): string | null {
  if (typeof body === "object" && body !== null && "Message" in body) {
    const m = (body as { Message?: unknown }).Message;
    if (typeof m === "string" && m) return m;
  }
  return null;
}

async function mintTicket(projectId: string, key: string): Promise<CachedTicket> {
  lastMintAt.set(key, Date.now());
  try {
    const dto = await api.post<TrackingTicketDto>(
      `/api/workstation-tracking/project/${encodeURIComponent(projectId)}/ticket`,
    );
    const expiresAtMs = Date.parse(dto.ExpiresAt);
    if (!dto?.Ticket || !dto.WorkstationUrl || !Number.isFinite(expiresAtMs)) {
      throw new TrackingError(500, "The server returned an invalid workstation ticket.");
    }
    const cached: CachedTicket = {
      ticket: dto.Ticket,
      expiresAtMs,
      baseUrl: dto.WorkstationUrl.replace(/\/+$/, ""),
    };
    // Drop the result if the user changed while the mint was in flight.
    if (key === cacheKey(projectId)) ticketCache.set(key, cached);
    return cached;
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 429) {
        const body = err.body as { RetryAfterSeconds?: unknown } | undefined;
        const retry = Number(body?.RetryAfterSeconds);
        throw new TrackingRateLimitedError(Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : 60);
      }
      if (err.status === 503) throw new TrackingNotConfiguredError(messageOf(err.body) ?? undefined);
      if (err.status === 403) {
        throw new TrackingError(403, "You don't have permission to view tracking data for this project.");
      }
      throw new TrackingError(err.status, err.message);
    }
    throw err;
  }
}

/** A valid ticket for this project, from cache when possible. */
export function getTicket(projectId: string): Promise<CachedTicket> {
  const key = cacheKey(projectId);
  const cached = ticketCache.get(key);
  if (isFresh(cached)) return Promise.resolve(cached);

  const inflight = inflightTickets.get(key);
  if (inflight) return inflight;

  const last = lastMintAt.get(key);
  if (last !== undefined) {
    const wait = last + TICKET_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) return Promise.reject(new TrackingRateLimitedError(Math.ceil(wait / 1000)));
  }

  const p = mintTicket(projectId, key).finally(() => {
    if (inflightTickets.get(key) === p) inflightTickets.delete(key);
  });
  inflightTickets.set(key, p);
  return p;
}

function dropTicket(projectId: string) {
  ticketCache.delete(cacheKey(projectId));
}

// ---------------------------------------------------------------------------------------------
// Data request queue (range + export): never two at once
// ---------------------------------------------------------------------------------------------

let dataQueue: Promise<unknown> = Promise.resolve();

function abortError(): DOMException {
  return new DOMException("The request was aborted.", "AbortError");
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function enqueueData<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  const result = dataQueue.then(() => (signal?.aborted ? Promise.reject(abortError()) : run()));
  dataQueue = result.catch(() => undefined);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Direct workstation fetch
// ---------------------------------------------------------------------------------------------

interface WsOptions {
  method?: string;
  body?: unknown;
  sessionId?: string;
  signal?: AbortSignal;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseUntil(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Date.parse(v);
    if (Number.isFinite(n)) return n;
    const asNum = Number(v);
    if (Number.isFinite(asNum)) return asNum;
  }
  return null;
}

async function errorFromResponse(res: Response): Promise<TrackingError> {
  const body = await readJson(res);
  const message = messageOf(body) ?? (typeof body === "string" && body.length < 300 ? body : null);
  if (res.status === 423) {
    const b = (body ?? {}) as { HeldBy?: unknown; Until?: unknown };
    const heldBy = typeof b.HeldBy === "string" && b.HeldBy ? b.HeldBy : null;
    return new TrackingLockedError(heldBy, parseUntil(b.Until), heldBy ? undefined : (message ?? undefined));
  }
  if (res.status === 429) {
    const header = Number(res.headers.get("Retry-After"));
    return new TrackingRateLimitedError(
      Number.isFinite(header) && header > 0 ? header : 2,
      message ?? "The workstation is busy with another request. Try again shortly.",
    );
  }
  if (res.status === 401) return new TrackingError(401, message ?? "The workstation rejected the ticket.");
  if (res.status === 403) return new TrackingError(403, message ?? "The workstation refused access for this project.");
  return new TrackingError(res.status, message ?? `Workstation request failed (${res.status}).`);
}

async function rawFetch(t: CachedTicket, path: string, opts: WsOptions): Promise<Response> {
  const headers = new Headers({ Authorization: `Bearer ${t.ticket}` });
  if (opts.sessionId) headers.set("X-Tracking-Session", opts.sessionId);
  if (opts.body !== undefined) headers.set("Content-Type", "application/json");
  try {
    return await fetch(`${t.baseUrl}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    if (err instanceof TypeError) throw new TrackingUnreachableError();
    throw err;
  }
}

/**
 * Fetch from the workstation with the project ticket. A 401 drops the cached ticket and retries
 * once with a new one (subject to the 60 s mint limit).
 */
async function wsFetch(projectId: string, path: string, opts: WsOptions = {}): Promise<Response> {
  let t = await getTicket(projectId);
  let res = await rawFetch(t, path, opts);
  if (res.status === 401) {
    dropTicket(projectId);
    t = await getTicket(projectId);
    res = await rawFetch(t, path, opts);
  }
  if (!res.ok) throw await errorFromResponse(res);
  return res;
}

async function wsJson(projectId: string, path: string, opts?: WsOptions): Promise<unknown> {
  const res = await wsFetch(projectId, path, opts);
  return readJson(res);
}

// ---------------------------------------------------------------------------------------------
// Normalization (the workstation payload is treated defensively)
// ---------------------------------------------------------------------------------------------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function toMatrix3(v: unknown): Matrix3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const rows = v.map((r) => (Array.isArray(r) && r.length === 3 ? r.map(num) : null));
  if (rows.some((r) => !r || r.some((c) => c === null))) return null;
  return rows as Matrix3;
}

export function normalizeMeta(raw: unknown): TrackingMeta {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  let span: [number, number] | null = null;
  if (Array.isArray(o.span) && o.span.length === 2) {
    const a = num(o.span[0]);
    const b = num(o.span[1]);
    if (a !== null && b !== null) span = [a, b];
  }

  let floorplan: TrackingFloorplan | null = null;
  if (typeof o.floorplan === "object" && o.floorplan !== null) {
    const f = o.floorplan as Record<string, unknown>;
    const width = num(f.width);
    const height = num(f.height);
    const T = toMatrix3(f.T_gt2px);
    if (width && height && width > 0 && height > 0 && T) floorplan = { width, height, T_gt2px: T };
  }

  const cameras: TrackingCamera[] = [];
  if (Array.isArray(o.cameras)) {
    for (const c of o.cameras) {
      if (typeof c !== "object" || c === null) continue;
      const r = c as Record<string, unknown>;
      const x = num(r.x);
      const y = num(r.y);
      if (x === null || y === null) continue;
      cameras.push({ name: typeof r.name === "string" ? r.name : "camera", x, y, z: num(r.z) ?? 0 });
    }
  }

  return {
    location_id: typeof o.location_id === "string" ? o.location_id : null,
    span,
    floorplan,
    cameras,
  };
}

export function normalizeRange(raw: unknown, query: TrackingRangeQuery): TrackingRange {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const people: TrackingPerson[] = [];
  if (Array.isArray(o.people)) {
    for (const p of o.people) {
      if (typeof p !== "object" || p === null) continue;
      const r = p as Record<string, unknown>;
      const t = Array.isArray(r.t) ? r.t : [];
      const x = Array.isArray(r.x) ? r.x : [];
      const y = Array.isArray(r.y) ? r.y : [];
      const n = Math.min(t.length, x.length, y.length);
      const pt: number[] = [];
      const px: number[] = [];
      const py: number[] = [];
      for (let i = 0; i < n; i++) {
        const ti = num(t[i]);
        const xi = num(x[i]);
        const yi = num(y[i]);
        if (ti === null || xi === null || yi === null) continue;
        pt.push(ti);
        px.push(xi);
        py.push(yi);
      }
      if (pt.length === 0) continue;
      const trackIds = Array.isArray(r.trackIds) ? r.trackIds.filter((v): v is number => num(v) !== null) : [];
      people.push({ id: r.id === undefined || r.id === null ? String(people.length + 1) : String(r.id), trackIds, t: pt, x: px, y: py });
    }
  }
  return {
    from: num(o.from) ?? query.from,
    to: num(o.to) ?? query.to,
    hz: num(o.hz) ?? query.hz ?? 5,
    mode: o.mode === "raw" || o.mode === "stitched" ? o.mode : query.mode,
    people,
  };
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export async function getMeta(projectId: string, signal?: AbortSignal): Promise<TrackingMeta> {
  return normalizeMeta(await wsJson(projectId, "/tracking/meta", { signal }));
}

/** The floor plan image as a Blob (the route needs the Authorization header, so no plain <img src>). */
export async function getFloorplanBlob(projectId: string, signal?: AbortSignal): Promise<Blob> {
  const res = await wsFetch(projectId, "/tracking/floorplan.png", { signal });
  return res.blob();
}

export async function acquireSession(projectId: string, kind: TrackingSessionKind): Promise<TrackingSessionDto> {
  const body = (await wsJson(projectId, "/tracking/session", { method: "POST", body: { kind } })) as
    | Partial<TrackingSessionDto>
    | undefined;
  if (!body?.SessionId) throw new TrackingError(500, "The workstation returned an invalid session.");
  return { SessionId: body.SessionId, ExpiresAt: body.ExpiresAt ?? "" };
}

const HEARTBEAT_RETRY_CAP_S = 10;

/**
 * Keeps the lease alive. A 404 or 423 means the lease is gone; both surface as TrackingLockedError.
 * A 429 is retried once after Retry-After (capped so it stays well inside the lease timeout).
 */
export async function heartbeatSession(projectId: string, sessionId: string): Promise<TrackingHeartbeatDto> {
  const path = `/tracking/session/${encodeURIComponent(sessionId)}/heartbeat`;
  const once = async () => {
    const body = (await wsJson(projectId, path, { method: "POST" })) as Partial<TrackingHeartbeatDto> | undefined;
    return { ExpiresAt: body?.ExpiresAt ?? "" };
  };
  try {
    try {
      return await once();
    } catch (err) {
      if (!(err instanceof TrackingRateLimitedError)) throw err;
      const waitS = Math.min(Math.max(err.retryAfterSeconds, 1), HEARTBEAT_RETRY_CAP_S);
      await new Promise((r) => setTimeout(r, waitS * 1000));
      return await once();
    }
  } catch (err) {
    if (err instanceof TrackingError && err.status === 404) throw new TrackingLockedError(null, null);
    throw err;
  }
}

/**
 * Best-effort release, safe to call from unmount and beforeunload: synchronous setup with the
 * cached ticket only (never mints a new one) and `keepalive` so it survives page unload. If no
 * usable ticket is cached the lease simply expires on the workstation after its heartbeat timeout.
 */
export function releaseSession(projectId: string, sessionId: string): void {
  const t = ticketCache.get(cacheKey(projectId));
  if (!t || t.expiresAtMs <= Date.now()) return;
  try {
    void fetch(`${t.baseUrl}/tracking/session/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${t.ticket}` },
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // ignore: release is best effort
  }
}

export function getRange(
  projectId: string,
  sessionId: string,
  query: TrackingRangeQuery,
  signal?: AbortSignal,
): Promise<TrackingRange> {
  return enqueueData(signal, () => fetchRange(projectId, sessionId, query, signal));
}

async function fetchRange(
  projectId: string,
  sessionId: string,
  query: TrackingRangeQuery,
  signal?: AbortSignal,
): Promise<TrackingRange> {
  const qs = new URLSearchParams({
    from: String(Math.round(query.from)),
    to: String(Math.round(query.to)),
    hz: String(query.hz ?? 5),
    mode: query.mode,
  });
  const raw = await wsJson(projectId, `/tracking/range?${qs}`, { sessionId, signal });
  return normalizeRange(raw, query);
}

function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get("Content-Disposition");
  const m = cd?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (m?.[1]) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  return fallback;
}

type ExportQuery = { from: number; to: number; mode: TrackingMode; format: TrackingExportFormat };

/** Streams an export to a Blob and triggers a browser download. */
export function downloadExport(
  projectId: string,
  sessionId: string,
  query: ExportQuery,
  signal?: AbortSignal,
): Promise<void> {
  return enqueueData(signal, () => fetchExport(projectId, sessionId, query, signal));
}

async function fetchExport(projectId: string, sessionId: string, query: ExportQuery, signal?: AbortSignal): Promise<void> {
  const qs = new URLSearchParams({
    from: String(Math.round(query.from)),
    to: String(Math.round(query.to)),
    mode: query.mode,
    format: query.format,
  });
  const res = await wsFetch(projectId, `/tracking/export?${qs}`, { sessionId, signal });
  const blob = await res.blob();
  const stamp = new Date(query.from).toISOString().replace(/[:.]/g, "-");
  const name = filenameFrom(res, `tracking-${query.mode}-${stamp}.${query.format}`);

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

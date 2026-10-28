/**
 * Wire DTOs for workstation tracking history (replay + export).
 *
 * The ticket comes from Express (`POST /api/workstation-tracking/project/:projectId/ticket`,
 * PascalCase like every other Express route). Everything else is fetched directly from the
 * workstation's tracking service over the tailnet (see services/workstationTrackingApi.ts);
 * its payloads are snake/camel case as defined by that service, except the session routes,
 * which use PascalCase.
 */

export interface TrackingTicketDto {
  Ticket: string;
  /** ISO timestamp. */
  ExpiresAt: string;
  WorkstationUrl: string;
}

export type Matrix3 = [[number, number, number], [number, number, number], [number, number, number]];

export interface TrackingFloorplan {
  width: number;
  height: number;
  /** World metres -> floor plan pixels, applied to [x, y, 1]. */
  T_gt2px: Matrix3;
}

export interface TrackingCamera {
  name: string;
  x: number;
  y: number;
  z: number;
}

/** `GET /tracking/meta`, normalized client side (missing or malformed fields become null/empty). */
export interface TrackingMeta {
  location_id: string | null;
  /** [oldestMs, newestMs] of recorded data, or null when nothing is recorded yet. */
  span: [number, number] | null;
  floorplan: TrackingFloorplan | null;
  cameras: TrackingCamera[];
}

export type TrackingSessionKind = "replay" | "export";

export interface TrackingSessionDto {
  SessionId: string;
  ExpiresAt: string;
}

export interface TrackingHeartbeatDto {
  ExpiresAt: string;
}

export interface TrackingLockedDto {
  HeldBy?: string;
  Until?: string | number;
}

/**
 * `fused` (default): one track per person, all cameras fused. `raw`: one track per tracker id.
 * The workstation's deprecated `stitched` mode is an alias of `fused` and is normalized to it.
 */
export type TrackingMode = "fused" | "raw";
export type TrackingExportFormat = "csv" | "jsonl";

/** One person (fused) or one tracker id (raw) as parallel columns. */
export interface TrackingPerson {
  id: string;
  trackIds: number[];
  /** Cameras that contributed to this track, when the workstation reports them. */
  cameras?: string[];
  /** Epoch ms, ascending. */
  t: number[];
  /** World metres. */
  x: number[];
  y: number[];
  /** Cameras contributing to each sample (parallel to `t`), when reported. */
  n_cams?: number[];
}

export interface TrackingPersonSummary {
  id: string;
  duration_s: number | null;
  /** Camera name -> fraction of this person's samples (0..1). */
  camera_share: Record<string, number>;
}

export interface TrackingOffsets {
  applied: boolean;
  needed: boolean;
  gain_m: number | null;
  learned_at_ms: number | null;
}

/** `summary` of `GET /tracking/range`, normalized client side (every field may be missing). */
export interface TrackingSummary {
  people: number | null;
  max_at_once: number | null;
  occupied_s: number | null;
  persons: TrackingPersonSummary[];
  /** Points dropped per cleaning stage, reduced to counts. */
  dropped: Record<string, number>;
  /** Sum of `dropped`, or null when the workstation reported none. */
  droppedTotal: number | null;
  offsets: TrackingOffsets | null;
  preset: string | null;
  config_error: string | null;
  /** Unknown cleaning config keys the workstation ignored; empty when none. */
  config_warnings: string[];
}

/** `GET /tracking/range`, normalized client side. */
export interface TrackingRange {
  from: number;
  to: number;
  hz: number;
  mode: TrackingMode;
  people: TrackingPerson[];
  /** Null when the workstation sent no summary. */
  summary: TrackingSummary | null;
}

export interface TrackingRangeQuery {
  from: number;
  to: number;
  mode: TrackingMode;
  hz?: number;
}

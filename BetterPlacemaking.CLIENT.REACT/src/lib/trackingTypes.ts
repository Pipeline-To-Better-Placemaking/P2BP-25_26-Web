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

export type TrackingMode = "stitched" | "raw";
export type TrackingExportFormat = "csv" | "jsonl";

/** One person (stitched) or one tracker id (raw) as parallel columns. */
export interface TrackingPerson {
  id: string;
  trackIds: number[];
  /** Epoch ms, ascending. */
  t: number[];
  /** World metres. */
  x: number[];
  y: number[];
}

/** `GET /tracking/range`, normalized client side. */
export interface TrackingRange {
  from: number;
  to: number;
  hz: number;
  mode: TrackingMode;
  people: TrackingPerson[];
}

export interface TrackingRangeQuery {
  from: number;
  to: number;
  mode: TrackingMode;
  hz?: number;
}

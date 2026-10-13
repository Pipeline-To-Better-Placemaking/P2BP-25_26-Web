/**
 * Ported from:
 *  - BetterPlacemaking.SERVER/Services/FusionEngine.cs (FusionEngineConfig, TrackEvent,
 *    TrackObject, FusedIdentity, HomographyEntry, FusionCameraIntrinsics, FusionRequest,
 *    FusionResult)
 *  - BetterPlacemaking.SERVER/Models/Fusion/FusionRun.cs, FusionConfig.cs (Document shapes)
 *  - BetterPlacemaking.SERVER/Models/Dtos/FusionDtos.cs (wire DTOs)
 *
 * The wire DTOs below (FusionRunDto/FusionConfigDto/TriggerFusionDto/UpdateFusionConfigDto)
 * must match BetterPlacemaking.CLIENT.REACT/src/lib/fusionTypes.ts field-for-field - that
 * file is the authoritative contract for the already-built frontend page.
 */

// ─────────────────────────────────────────────
// ENGINE CONFIG — ported verbatim from FusionEngineConfig (FusionEngine.cs).
// Every constant here gates a fusion/matching decision; do not "round" or "simplify" any
// of these values without re-reading the C# source.
// ─────────────────────────────────────────────
export const FusionEngineConfig = {
  InputStorageFolder: "vision/tracks-raw",
  OutputStorageFolder: "vision/tracks-fused",

  SimThreshold: 0.75,

  // World coordinates are in millimetres (homography output).
  // 8 m/s ≈ fast jogging — anything faster is almost certainly a different person or a vehicle.
  MaxSpeedWorldPerS: 8000.0, // mm / s

  // Hard absolute distance cap between gid endpoint and new track start,
  // applied independently of the speed/time math. 30 m ≈ across a small plaza.
  MaxJumpFusion: 30000.0, // mm

  MaxGapMs: 12000.0,
  MinTrackPoints: 8,
  MinDurationS: 1.0,
  MaxJumpClean: 6000.0, // mm — per-point jump filter
  DupEps: 1e-3,
  SmoothWin: 2,
} as const;

// ─────────────────────────────────────────────
// ENGINE DATA MODELS — ported from FusionEngine.cs
// ─────────────────────────────────────────────

/** Mirrors TrackEvent. */
export interface TrackEvent {
  x: number;
  y: number;
  time: number; // ms epoch
  cam: string;
  sid: number;
}

/** Mirrors TrackObject. `rep` is the averaged re-id embedding vector for this (cam,sid). */
export interface TrackObject {
  cam: string;
  sid: number;
  rep: number[];
  tStart: number;
  tEnd: number;
  x: number;
  y: number;
  events: TrackEvent[];
}

/** Mirrors FusedIdentity. `sources` is the deduped ordered list of (cam,sid) folded into this gid. */
export interface FusedIdentity {
  gid: number;
  rep: number[];
  tStart: number;
  tEnd: number;
  x: number;
  y: number;
  tracks: TrackEvent[][];
  sources: { cam: string; sid: number }[];
}

/** Mirrors HomographyEntry. */
export interface HomographyEntry {
  matrix: number[][]; // 3x3
  usedUndistortedImage: boolean;
}

/** Mirrors FusionCameraIntrinsics. */
export interface FusionCameraIntrinsics {
  cameraMatrix: number[][]; // 3x3
  distCoeffs: number[];
}

/** Mirrors FusionRequest. From/To are required — the runner throws (returns a failed FusionResult) if absent. */
export interface FusionRequest {
  inputStorageFolder?: string | null;
  outputStorageFolder?: string | null;
  from: Date;
  to: Date;
}

/** Mirrors FusionResult. */
export interface FusionResult {
  success: boolean;
  message: string;
}

// ─────────────────────────────────────────────
// DOC SHAPES — ported from Models/Fusion/FusionRun.cs, FusionConfig.cs
// ─────────────────────────────────────────────

export type FusionRunStatus = "running" | "cancelling" | "cancelled" | "success" | "failed" | "unknown";
// "scheduled" (not the C# source's "scheduler") to match the already-built frontend's
// FusionTriggeredBy type in fusionTypes.ts - this value is never produced yet (the
// scheduler poller itself isn't ported), so there's no compatibility reason to match
// the old string, and aligning now avoids a mismatch resurfacing later.
export type FusionTriggeredBy = "manual" | "scheduled" | "unknown";

/** Document shape for the `fusion_runs` collection. */
export interface FusionRunDoc {
  Status?: string | null;
  TriggeredBy?: string | null;
  FromDateUnix?: number | null;
  ToDateUnix?: number | null;
  StartedAtUnix?: number | null;
  CompletedAtUnix?: number | null;
  RecordsFused?: number | null;
  ErrorMessage?: string | null;
  OutputGcsPath?: string | null;
  ProjectId?: string | null;
}

export interface FusionRun extends FusionRunDoc {
  Id: string;
}

/** Document shape for the `fusion_config` collection (one doc per project, keyed by projectId, or "default"). */
export interface FusionConfigDoc {
  ScheduledHourUtc: number;
  ScheduledMinuteUtc: number;
  Enabled: boolean;
  UpdatedAtUnix?: number | null;
  ProjectId?: string | null;
}

// ─────────────────────────────────────────────
// WIRE DTOs — must match fusionTypes.ts exactly (field-for-field, PascalCase)
// ─────────────────────────────────────────────

export interface FusionRunDto {
  Id: string;
  Status: FusionRunStatus;
  TriggeredBy: FusionTriggeredBy;
  FromDateUnix?: number;
  ToDateUnix?: number;
  StartedAtUnix?: number;
  CompletedAtUnix?: number;
  RecordsFused?: number;
  ErrorMessage?: string;
  OutputGcsPath?: string;
  ProjectId?: string;
}

export interface FusionConfigDto {
  ScheduledHourUtc: number;
  ScheduledMinuteUtc: number;
  Enabled: boolean;
  ProjectId?: string;
}

export interface TriggerFusionDto {
  FromDateUnix: number;
  ToDateUnix: number;
  ProjectId?: string;
}

export interface UpdateFusionConfigDto {
  ScheduledHourUtc: number;
  ScheduledMinuteUtc: number;
  Enabled: boolean;
  ProjectId?: string;
}

/** Mirrors FusionService.ToDto. */
export function toFusionRunDto(r: FusionRun): FusionRunDto {
  return {
    Id: r.Id ?? "",
    Status: (r.Status as FusionRunStatus | undefined) ?? "unknown",
    TriggeredBy: (r.TriggeredBy as FusionTriggeredBy | undefined) ?? "unknown",
    FromDateUnix: r.FromDateUnix ?? undefined,
    ToDateUnix: r.ToDateUnix ?? undefined,
    StartedAtUnix: r.StartedAtUnix ?? undefined,
    CompletedAtUnix: r.CompletedAtUnix ?? undefined,
    RecordsFused: r.RecordsFused ?? undefined,
    ErrorMessage: r.ErrorMessage ?? undefined,
    OutputGcsPath: r.OutputGcsPath ?? undefined,
    ProjectId: r.ProjectId ?? undefined,
  };
}

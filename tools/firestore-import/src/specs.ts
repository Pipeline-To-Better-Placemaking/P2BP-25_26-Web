/**
 * Declarative mapping of legacy Firestore collections onto the new Postgres tables.
 * Firestore field names are the PascalCase API shapes (members use camelCase); column names are
 * those of BetterPlacemaking.SERVER.EXPRESS/src/db/schema/*.ts. A parity test checks every column exists.
 */
import { type ColType, jsonSafe } from "./convert.js";

export interface RawDoc {
  id: string;
  /** Full Firestore document path, e.g. "projects/p1/members/u1". */
  path: string;
  data: Record<string, unknown>;
  createTime?: unknown;
  updateTime?: unknown;
}

export interface Ctx {
  doc: RawDoc;
  data: Record<string, unknown>;
  /** Path segments, e.g. ["projects","p1","members","u1"]. */
  seg: string[];
}

export interface ColSpec {
  col: string;
  type: ColType;
  /** Firestore field name(s) tried in order. */
  field?: string | string[];
  /** Computed source value (wins over `field`). */
  from?: (c: Ctx) => unknown;
  /** Value used when the source is null/missing. */
  def?: unknown | ((c: Ctx) => unknown);
  /** Missing (after default) makes the doc invalid. */
  req?: boolean;
}

export type SourceRef = { kind: "collection"; name: string } | { kind: "group"; name: string };

export type StorageMode = "object" | "url";

export interface StorageCol {
  col: string;
  /** "object": value is a storage object name. "url": absolute/own-bucket URLs or object names. */
  mode: StorageMode;
  /** false: report-only (never rewritten, never copied). */
  rewrite: boolean;
}

export interface TableSpec {
  key: string; // --only name
  table: string;
  source: SourceRef;
  /** Path pattern for collection-group sources; "*" matches any segment. */
  pattern?: string[];
  include?: (c: Ctx) => boolean;
  pk: string[];
  cols: ColSpec[];
  /** FK columns: parent spec key whose single pk holds the referenced id. */
  fks?: { col: string; parent: string }[];
  /** Extra unique columns (besides pk) to pre-check so conflicts are reported, not fatal. */
  unique?: string[];
  storage?: StorageCol[];
  /** Not imported unless an explicit flag is given. */
  optIn?: boolean;
}

const createdFallback = (c: Ctx) => c.doc.createTime ?? new Date();
const updatedFallback = (c: Ctx) => c.doc.updateTime ?? c.doc.createTime ?? new Date();

const t = (col: string, field: string, extra: Partial<ColSpec> = {}): ColSpec => ({ col, type: "text", field, ...extra });
const i = (col: string, field: string, extra: Partial<ColSpec> = {}): ColSpec => ({ col, type: "int", field, ...extra });
const f = (col: string, field: string, extra: Partial<ColSpec> = {}): ColSpec => ({ col, type: "float", field, ...extra });
const b = (col: string, field: string, extra: Partial<ColSpec> = {}): ColSpec => ({ col, type: "bool", field, ...extra });
const j = (col: string, field: string, extra: Partial<ColSpec> = {}): ColSpec => ({ col, type: "json", field, ...extra });
const d = (col: string, field: string | string[], extra: Partial<ColSpec> = {}): ColSpec => ({ col, type: "ts", field, ...extra });
const idCol = (col = "id"): ColSpec => ({ col, type: "text", from: (c) => c.doc.id, req: true });
const segCol = (col: string, index: number): ColSpec => ({ col, type: "text", from: (c) => c.seg[index], req: true });

const SCAN_FIRST_CLASS = ["Status", "CreatedAt", "StartedAt", "FinishedAt", "ObjUrl", "Error", "InitiatedByUserId"];
const isCalibrationScan = (c: Ctx) => c.data.IsUploadedCalibrationScan === true || c.data.IsCombinedCalibrationScan === true;
const SCANS_PATTERN = ["projects", "*", "devices", "*", "scans", "*"];

/** Processing order = FK dependency order. */
export const SPECS: TableSpec[] = [
  {
    key: "users",
    table: "users",
    source: { kind: "collection", name: "users" },
    pk: ["id"],
    unique: ["email"],
    cols: [
      idCol(),
      t("first_name", "FirstName"),
      t("last_name", "LastName"),
      t("email", "Email"),
      t("password", "Password"),
      t("role", "Role"),
      b("email_alerts", "EmailAlerts"),
      b("email_verified", "EmailVerified", { def: false }),
      t("email_verification_token", "EmailVerificationToken"),
      t("password_reset_token", "PasswordResetToken"),
      d("password_reset_token_expiry", "PasswordResetTokenExpiry"),
      d("created_at", ["CreatedAt", "createdAt"], { def: createdFallback }),
    ],
  },
  {
    key: "user_global_roles",
    table: "user_global_roles",
    source: { kind: "collection", name: "user_global_roles" },
    pk: ["user_id"],
    fks: [{ col: "user_id", parent: "users" }],
    cols: [
      idCol("user_id"),
      { col: "roles", type: "textarr", field: "roles", def: [] },
      d("updated_at", ["updatedAt", "UpdatedAt"], { def: updatedFallback }),
    ],
  },
  {
    key: "projects",
    table: "projects",
    source: { kind: "collection", name: "projects" },
    pk: ["id"],
    cols: [
      idCol(),
      t("title", "Title"),
      t("description", "Description"),
      t("location", "Location"),
      d("created_at", ["CreatedAt", "createdAt"], { def: createdFallback }),
    ],
  },
  {
    key: "project_members",
    table: "project_members",
    source: { kind: "group", name: "members" },
    pattern: ["projects", "*", "members", "*"],
    pk: ["project_id", "user_id"],
    fks: [
      { col: "project_id", parent: "projects" },
      { col: "user_id", parent: "users" },
    ],
    cols: [
      segCol("project_id", 1),
      segCol("user_id", 3),
      { col: "roles", type: "textarr", field: "roles", def: [] },
      i("authz_version", "authzVersion", { def: 0 }),
      b("notify_on_own_scan", "notifyOnOwnScan", { def: false }),
      b("notify_on_others_scan", "notifyOnOthersScan", { def: false }),
      b("notify_on_scheduled_scan", "notifyOnScheduledScan", { def: false }),
      b("notify_on_system_toggle", "notifyOnSystemToggle", { def: false }),
      b("notify_on_health_alert", "notifyOnHealthAlert", { def: false }),
      b("email_pdf_on_system_off", "emailPdfOnSystemOff", { def: false }),
      d("updated_at", "updatedAt", { def: updatedFallback }),
    ],
  },
  {
    key: "devices",
    table: "devices",
    source: { kind: "collection", name: "devices" },
    pk: ["id"],
    fks: [{ col: "project_id", parent: "projects" }],
    cols: [
      idCol(),
      t("project_id", "ProjectId"),
      t("name", "Name"),
      j("config", "Config"),
      j("health_report", "HealthReport"),
      t("api_key_hash", "ApiKeyHash"),
    ],
  },
  {
    key: "scans",
    table: "scans",
    source: { kind: "group", name: "scans" },
    pattern: SCANS_PATTERN,
    include: (c) => !isCalibrationScan(c),
    pk: ["id"],
    fks: [{ col: "project_id", parent: "projects" }],
    storage: [{ col: "obj_url", mode: "url", rewrite: true }],
    cols: [
      idCol(),
      segCol("project_id", 1),
      segCol("device_id", 3),
      t("status", "Status"),
      d("created_at", "CreatedAt", { def: createdFallback }),
      d("started_at", "StartedAt"),
      d("finished_at", "FinishedAt"),
      t("obj_url", "ObjUrl"),
      t("error", "Error"),
      t("initiated_by_user_id", "InitiatedByUserId"),
      {
        col: "extra",
        type: "json",
        def: {},
        from: (c) => {
          const rest: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(c.data)) if (!SCAN_FIRST_CLASS.includes(k)) rest[k] = v;
          return jsonSafe(rest);
        },
      },
    ],
  },
  {
    key: "scan_schedules",
    table: "scan_schedules",
    source: { kind: "group", name: "scan_schedules" },
    pattern: ["projects", "*", "scan_schedules", "*"],
    pk: ["id"],
    fks: [{ col: "project_id", parent: "projects" }],
    cols: [
      idCol(),
      segCol("project_id", 1),
      t("start_date", "StartDate"),
      t("start_time", "StartTime"),
      t("frequency", "Frequency"),
      t("end_date", "EndDate"),
      t("end_time", "EndTime"),
      d("created_at", "CreatedAt", { def: createdFallback }),
      t("created_by_user_id", "CreatedByUserId"),
      d("last_run_at", "LastRunAt"),
    ],
  },
  {
    key: "camera_intrinsics",
    table: "camera_intrinsics",
    source: { kind: "collection", name: "camera_intrinsics" },
    pk: ["id"],
    cols: [
      idCol(),
      t("model_id", "ModelId"),
      t("device_id", "DeviceId"),
      t("camera_mac", "CameraMac"),
      b("is_per_unit", "IsPerUnit", { def: false }),
      j("camera_matrix_flat", "CameraMatrixFlat"),
      j("distortion_coefficients", "DistortionCoefficients"),
      f("reprojection_error", "ReprojectionError"),
      i("sightings_used", "SightingsUsed"),
      f("computed_at_unix", "ComputedAtUnix"),
    ],
  },
  {
    key: "intrinsics_sightings",
    table: "intrinsics_sightings",
    source: { kind: "collection", name: "intrinsics_sightings" },
    pk: ["id"],
    cols: [
      idCol(),
      t("model_id", "ModelId"),
      t("device_id", "DeviceId"),
      t("camera_mac", "CameraMac"),
      b("is_per_unit", "IsPerUnit", { def: false }),
      t("captured_at", "CapturedAt"),
      j("image_points", "ImagePoints"),
      j("corner_ids", "CornerIds"),
      j("frame_size", "FrameSize"),
      f("rmse", "Rmse"),
    ],
  },
  {
    key: "local_homographies",
    table: "local_homographies",
    source: { kind: "collection", name: "local_homographies" },
    pk: ["id"],
    storage: [{ col: "snapshot_path", mode: "object", rewrite: true }],
    cols: [
      idCol(),
      t("device_id", "DeviceId"),
      t("camera_mac", "CameraMac"),
      j("matrix_flat", "MatrixFlat"),
      j("frame_size", "FrameSize"),
      f("inliers", "Inliers"),
      f("rmse_board", "RmseBoard"),
      i("corners_used", "CornersUsed"),
      i("markers_detected", "MarkersDetected"),
      t("aruco_dict", "ArucoDict"),
      i("squares_x", "SquaresX"),
      i("squares_y", "SquaresY"),
      f("square_length", "SquareLength"),
      f("marker_length", "MarkerLength"),
      f("timestamp_unix", "TimestampUnix"),
      t("snapshot_path", "SnapshotPath"),
      j("camera_matrix_flat", "CameraMatrixFlat"),
      j("distortion_coefficients", "DistortionCoefficients"),
      b("used_undistorted_image", "UsedUndistortedImage"),
    ],
  },
  {
    key: "aruco_sessions",
    table: "aruco_sessions",
    source: { kind: "collection", name: "aruco_sessions" },
    pk: ["id"],
    cols: [
      idCol(),
      t("aruco_dict", "ArucoDict"),
      t("status", "Status", { req: true }),
      { col: "cameras_checked_in", type: "textarr", field: "CamerasCheckedIn", def: [] },
      i("cameras_total", "CamerasTotal", { def: 0 }),
      d("created_at", "CreatedAt", { def: createdFallback }),
    ],
  },
  {
    key: "aruco_sightings",
    table: "aruco_sightings",
    source: { kind: "collection", name: "aruco_sightings" },
    pk: ["id"],
    cols: [
      idCol(),
      t("session_id", "SessionId"),
      t("device_id", "DeviceId"),
      t("camera_mac", "CameraMac"),
      t("aruco_dict", "ArucoDict"),
      t("captured_at", "CapturedAt"),
      j("markers", "Markers"),
      t("local_homography_hash", "LocalHomographyHash"),
    ],
  },
  {
    key: "locked_homographies",
    table: "locked_homographies",
    source: { kind: "collection", name: "locked_homographies" },
    pk: ["id"],
    cols: [
      idCol(),
      t("device_id", "DeviceId"),
      t("camera_mac", "CameraMac"),
      j("matrix_flat", "MatrixFlat"),
      d("computed_at", "ComputedAt", { def: createdFallback }),
    ],
  },
  {
    key: "puzzle_pieces",
    table: "puzzle_pieces",
    source: { kind: "collection", name: "puzzle_pieces" },
    pk: ["id"],
    fks: [{ col: "project_id", parent: "projects" }],
    storage: [
      { col: "source_snapshot_path", mode: "object", rewrite: true },
      { col: "puzzle_piece_path", mode: "object", rewrite: true },
      { col: "metadata_path", mode: "object", rewrite: true },
      { col: "homography_file", mode: "object", rewrite: true },
    ],
    cols: [
      idCol(),
      t("project_id", "ProjectId"),
      t("device_id", "DeviceId"),
      t("camera_mac", "CameraMac"),
      t("local_homography_id", "LocalHomographyId"),
      t("local_homography_hash", "LocalHomographyHash"),
      j("local_homography_matrix_flat", "LocalHomographyMatrixFlat"),
      j("h_local_canvas_flat", "HLocalCanvasFlat"),
      j("source_frame_size", "SourceFrameSize"),
      j("puzzle_piece_size", "PuzzlePieceSize"),
      t("source_snapshot_path", "SourceSnapshotPath"),
      b("used_undistorted_image", "UsedUndistortedImage", { def: false }),
      t("undistort_mode", "UndistortMode"),
      f("bbox_trim_pct", "BboxTrimPct", { def: 0 }),
      t("homography_file", "HomographyFile"),
      t("puzzle_piece_path", "PuzzlePiecePath"),
      t("metadata_path", "MetadataPath"),
      i("generation_version", "GenerationVersion", { def: 0 }),
      d("generated_at", "GeneratedAt", { def: createdFallback }),
    ],
  },
  {
    key: "global_homographies",
    table: "global_homographies",
    source: { kind: "collection", name: "global_homographies" },
    pk: ["project_id"],
    fks: [{ col: "project_id", parent: "projects" }],
    cols: [
      idCol("project_id"),
      t("floorplan_id", "FloorplanId"),
      f("mm_per_fp_px", "MmPerFpPx", { req: true }),
      j("origin_fp", "OriginFp"),
      j("floorplan_size", "FloorplanSize"),
      j("placements", "Placements"),
      j("locked_groups", "LockedGroups"),
      t("saved_by_user_id", "SavedByUserId"),
      d("saved_at", "SavedAt", { def: updatedFallback }),
    ],
  },
  {
    key: "board_library",
    table: "board_library",
    source: { kind: "collection", name: "board_library" },
    pk: ["id"],
    cols: [
      idCol(),
      t("user_id", "UserId", { req: true }),
      t("type", "Type", { req: true }),
      t("nickname", "Nickname", { req: true }),
      t("dictionary", "Dictionary", { req: true }),
      t("units", "Units", { req: true }),
      i("cols", "Cols"),
      i("rows", "Rows"),
      i("marker_id", "MarkerId"),
      f("square_size", "SquareSize"),
      f("marker_size", "MarkerSize", { req: true }),
      f("square_size_mm", "SquareSizeMm"),
      f("marker_size_mm", "MarkerSizeMm", { req: true }),
      t("preview_svg", "PreviewSvg", { req: true }),
      d("created_at_utc", "CreatedAtUtc", { def: createdFallback }),
    ],
  },
  {
    key: "floorplan_library",
    table: "floorplan_library",
    source: { kind: "collection", name: "floorplan_library" },
    pk: ["id"],
    storage: [{ col: "image_path", mode: "object", rewrite: true }],
    cols: [
      idCol(),
      t("user_id", "UserId", { req: true }),
      t("project_id", "ProjectId"),
      t("nickname", "Nickname"),
      t("image_path", "ImagePath"),
      t("image_content_type", "ImageContentType"),
      i("image_size_bytes", "ImageSizeBytes", { req: true }),
      i("image_width", "ImageWidth", { req: true }),
      i("image_height", "ImageHeight", { req: true }),
      j("calibration", "Calibration"),
      d("created_at_utc", "CreatedAtUtc", { def: createdFallback }),
      d("updated_at_utc", "UpdatedAtUtc", { def: updatedFallback }),
    ],
  },
  {
    key: "fusion_runs",
    table: "fusion_runs",
    source: { kind: "collection", name: "fusion_runs" },
    pk: ["id"],
    storage: [{ col: "output_gcs_path", mode: "object", rewrite: true }],
    cols: [
      idCol(),
      t("status", "Status"),
      t("triggered_by", "TriggeredBy"),
      f("from_date_unix", "FromDateUnix"),
      f("to_date_unix", "ToDateUnix"),
      f("started_at_unix", "StartedAtUnix"),
      f("completed_at_unix", "CompletedAtUnix"),
      i("records_fused", "RecordsFused"),
      t("error_message", "ErrorMessage"),
      t("output_gcs_path", "OutputGcsPath"),
      t("project_id", "ProjectId"),
    ],
  },
  {
    key: "fusion_config",
    table: "fusion_config",
    source: { kind: "collection", name: "fusion_config" },
    pk: ["id"],
    cols: [
      idCol(),
      i("scheduled_hour_utc", "ScheduledHourUtc", { req: true }),
      i("scheduled_minute_utc", "ScheduledMinuteUtc", { req: true }),
      b("enabled", "Enabled", { req: true }),
      f("updated_at_unix", "UpdatedAtUnix"),
      t("project_id", "ProjectId"),
    ],
  },
  {
    key: "scan_calibration_records",
    table: "scan_calibration_records",
    source: { kind: "group", name: "scans" },
    pattern: SCANS_PATTERN,
    include: isCalibrationScan,
    pk: ["id"],
    // Local filesystem path or absolute URL in the new service: reported, never rewritten.
    storage: [{ col: "obj_url", mode: "url", rewrite: false }],
    cols: [
      idCol(),
      segCol("project_id", 1),
      segCol("device_id", 3),
      t("status", "Status", { req: true }),
      d("created_at", "CreatedAt", { req: true, def: createdFallback }),
      d("started_at", "StartedAt"),
      d("finished_at", "FinishedAt"),
      t("obj_url", "ObjUrl"),
      t("error", "Error"),
      b("is_uploaded_calibration_scan", "IsUploadedCalibrationScan", { def: false }),
      b("is_combined_calibration_scan", "IsCombinedCalibrationScan", { def: false }),
      t("original_file_name", "OriginalFileName"),
      t("output_name", "OutputName"),
      f("scalar_mm_per_pixel", "ScalarMmPerPixel"),
      { col: "source_scan_ids", type: "textarr", field: "SourceScanIds" },
      j("combine_transforms", "CombineTransforms"),
    ],
  },
  {
    key: "refresh_tokens",
    table: "refresh_tokens",
    source: { kind: "collection", name: "refreshTokens" },
    optIn: true,
    pk: ["id"],
    unique: ["token_hash"],
    fks: [{ col: "user_id", parent: "users" }],
    cols: [
      idCol(),
      t("user_id", "UserId"),
      t("token_hash", "TokenHash", { req: true }),
      d("created_at_utc", "CreatedAtUtc", { def: createdFallback }),
      d("expires_at_utc", "ExpiresAtUtc", { req: true }),
      d("revoked_at_utc", "RevokedAtUtc"),
      t("replaced_by_token_id", "ReplacedByTokenId"),
      t("user_agent", "UserAgent"),
    ],
  },
];

/** Firestore root collections that are known and either mapped above or deliberately skipped. */
export const SKIPPED_COLLECTIONS: Record<string, string> = {
  role_definitions_global: "system roles are seeded by the app (db:seed-roles); never overwritten",
  role_definitions_project: "system roles are seeded by the app (db:seed-roles); never overwritten",
};

export function knownRootCollections(): Set<string> {
  const s = new Set<string>(Object.keys(SKIPPED_COLLECTIONS));
  for (const spec of SPECS) {
    if (spec.source.kind === "collection") s.add(spec.source.name);
  }
  s.add("projects"); // members/devices/scans/scan_schedules live under it
  return s;
}

export function matchesPattern(seg: string[], pattern: string[] | undefined): boolean {
  if (!pattern) return true;
  return seg.length === pattern.length && pattern.every((p, idx) => p === "*" || p === seg[idx]);
}

import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projects } from "./core.js";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Firestore top-level `devices`. Config/HealthReport are opaque Jetson payloads, kept as jsonb. */
export const devices = pgTable(
  "devices",
  {
    id: id(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    name: text("name"),
    config: jsonb("config").$type<Record<string, unknown>>(),
    healthReport: jsonb("health_report").$type<Record<string, unknown>>(),
    apiKeyHash: text("api_key_hash"),
  },
  (t) => [index("devices_project_id_idx").on(t.projectId), index("devices_api_key_hash_idx").on(t.apiKeyHash)],
);

/**
 * Firestore `projects/{projectId}/devices/{deviceId}/scans`. The device id is the same id as
 * `devices.id` but deliberately not an FK (the old subtree hangs off a "shadow" device doc).
 * Fields beyond the first-class columns (scan settings, calibration flags, ...) live in `extra`,
 * keyed exactly as they were on the Firestore document.
 */
export const scans = pgTable(
  "scans",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    status: text("status"),
    createdAt: ts("created_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    objUrl: text("obj_url"),
    error: text("error"),
    initiatedByUserId: text("initiated_by_user_id"),
    extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("scans_project_device_idx").on(t.projectId, t.deviceId)],
);

/** Firestore `projects/{projectId}/scan_schedules`. */
export const scanSchedules = pgTable(
  "scan_schedules",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    startDate: text("start_date"),
    startTime: text("start_time"),
    frequency: text("frequency"),
    endDate: text("end_date"),
    endTime: text("end_time"),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    lastRunAt: ts("last_run_at"),
  },
  (t) => [index("scan_schedules_project_id_idx").on(t.projectId)],
);

/** Firestore `intrinsics_sightings`. */
export const intrinsicsSightings = pgTable(
  "intrinsics_sightings",
  {
    id: id(),
    modelId: text("model_id"),
    deviceId: text("device_id"),
    cameraMac: text("camera_mac"),
    isPerUnit: boolean("is_per_unit").notNull().default(false),
    capturedAt: text("captured_at"),
    imagePoints: jsonb("image_points").$type<number[][]>(),
    cornerIds: jsonb("corner_ids").$type<number[]>(),
    frameSize: jsonb("frame_size").$type<number[]>(),
    rmse: doublePrecision("rmse"),
  },
  (t) => [index("intrinsics_sightings_device_idx").on(t.deviceId)],
);

/** Firestore `camera_intrinsics`; id = "{deviceId}_{mac}" (per unit) or the model id. */
export const cameraIntrinsics = pgTable("camera_intrinsics", {
  id: id(),
  modelId: text("model_id"),
  deviceId: text("device_id"),
  cameraMac: text("camera_mac"),
  isPerUnit: boolean("is_per_unit").notNull().default(false),
  cameraMatrixFlat: jsonb("camera_matrix_flat").$type<number[]>(),
  distortionCoefficients: jsonb("distortion_coefficients").$type<number[]>(),
  reprojectionError: doublePrecision("reprojection_error"),
  sightingsUsed: integer("sightings_used"),
  computedAtUnix: doublePrecision("computed_at_unix"),
});

/** Firestore `local_homographies`; id = "{deviceId}_{cameraMac}". */
export const localHomographies = pgTable(
  "local_homographies",
  {
    id: id(),
    deviceId: text("device_id"),
    cameraMac: text("camera_mac"),
    matrixFlat: jsonb("matrix_flat").$type<number[]>(),
    frameSize: jsonb("frame_size").$type<number[]>(),
    inliers: doublePrecision("inliers"),
    rmseBoard: doublePrecision("rmse_board"),
    cornersUsed: integer("corners_used"),
    markersDetected: integer("markers_detected"),
    arucoDict: text("aruco_dict"),
    squaresX: integer("squares_x"),
    squaresY: integer("squares_y"),
    squareLength: doublePrecision("square_length"),
    markerLength: doublePrecision("marker_length"),
    timestampUnix: doublePrecision("timestamp_unix"),
    snapshotPath: text("snapshot_path"),
    cameraMatrixFlat: jsonb("camera_matrix_flat").$type<number[]>(),
    distortionCoefficients: jsonb("distortion_coefficients").$type<number[]>(),
    usedUndistortedImage: boolean("used_undistorted_image"),
  },
  (t) => [index("local_homographies_device_id_idx").on(t.deviceId)],
);

/** Firestore `aruco_sessions`. */
export const arucoSessions = pgTable("aruco_sessions", {
  id: id(),
  arucoDict: text("aruco_dict"),
  status: text("status").notNull(),
  camerasCheckedIn: text("cameras_checked_in").array().notNull().default([]),
  camerasTotal: integer("cameras_total").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Firestore `aruco_sightings`; id = "{sessionId}_{cameraMac}". */
export const arucoSightings = pgTable("aruco_sightings", {
  id: id(),
  sessionId: text("session_id"),
  deviceId: text("device_id"),
  cameraMac: text("camera_mac"),
  arucoDict: text("aruco_dict"),
  capturedAt: text("captured_at"),
  markers: jsonb("markers").$type<Array<{ MarkerId: number; CornersPxFlat?: number[] | null }>>(),
  localHomographyHash: text("local_homography_hash"),
});

/** Firestore `locked_homographies`; id = "{deviceId}_{cameraMac}". */
export const lockedHomographies = pgTable("locked_homographies", {
  id: id(),
  deviceId: text("device_id"),
  cameraMac: text("camera_mac"),
  matrixFlat: jsonb("matrix_flat").$type<number[]>(),
  computedAt: ts("computed_at").notNull().defaultNow(),
});

/** Firestore `puzzle_pieces`; id = "{projectId}__{deviceId}__{mac with ':' -> '_'}". */
export const puzzlePieces = pgTable(
  "puzzle_pieces",
  {
    id: id(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    deviceId: text("device_id"),
    cameraMac: text("camera_mac"),
    localHomographyId: text("local_homography_id"),
    localHomographyHash: text("local_homography_hash"),
    localHomographyMatrixFlat: jsonb("local_homography_matrix_flat").$type<number[]>(),
    hLocalCanvasFlat: jsonb("h_local_canvas_flat").$type<number[]>(),
    sourceFrameSize: jsonb("source_frame_size").$type<number[]>(),
    puzzlePieceSize: jsonb("puzzle_piece_size").$type<number[]>(),
    sourceSnapshotPath: text("source_snapshot_path"),
    usedUndistortedImage: boolean("used_undistorted_image").notNull().default(false),
    undistortMode: text("undistort_mode"),
    bboxTrimPct: doublePrecision("bbox_trim_pct").notNull().default(0),
    homographyFile: text("homography_file"),
    puzzlePiecePath: text("puzzle_piece_path"),
    metadataPath: text("metadata_path"),
    generationVersion: integer("generation_version").notNull().default(0),
    generatedAt: ts("generated_at").notNull().defaultNow(),
  },
  (t) => [index("puzzle_pieces_project_id_idx").on(t.projectId)],
);

/** Firestore `global_homographies`; id = project id. Placements/lockedGroups keep their PascalCase record shape. */
export const globalHomographies = pgTable("global_homographies", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  floorplanId: text("floorplan_id"),
  mmPerFpPx: doublePrecision("mm_per_fp_px").notNull(),
  originFp: jsonb("origin_fp").$type<number[]>(),
  floorplanSize: jsonb("floorplan_size").$type<number[]>(),
  placements: jsonb("placements").$type<unknown[]>(),
  lockedGroups: jsonb("locked_groups").$type<unknown[]>(),
  savedByUserId: text("saved_by_user_id"),
  savedAt: ts("saved_at").notNull().defaultNow(),
});

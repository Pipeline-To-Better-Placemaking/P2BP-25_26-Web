import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());

/** Legacy `fusion_runs`. Unix-seconds fields stay doubles, as the API returns them. */
export const fusionRuns = pgTable(
  "fusion_runs",
  {
    id: id(),
    status: text("status"),
    triggeredBy: text("triggered_by"),
    fromDateUnix: doublePrecision("from_date_unix"),
    toDateUnix: doublePrecision("to_date_unix"),
    startedAtUnix: doublePrecision("started_at_unix"),
    completedAtUnix: doublePrecision("completed_at_unix"),
    recordsFused: integer("records_fused"),
    errorMessage: text("error_message"),
    outputGcsPath: text("output_gcs_path"),
    projectId: text("project_id"),
  },
  (t) => [index("fusion_runs_project_id_idx").on(t.projectId), index("fusion_runs_status_idx").on(t.status)],
);

/** Legacy `fusion_config`; doc id = projectId or "default". */
export const fusionConfig = pgTable("fusion_config", {
  id: text("id").primaryKey(),
  scheduledHourUtc: integer("scheduled_hour_utc").notNull(),
  scheduledMinuteUtc: integer("scheduled_minute_utc").notNull(),
  enabled: boolean("enabled").notNull(),
  updatedAtUnix: doublePrecision("updated_at_unix"),
  projectId: text("project_id"),
});

/**
 * Visualizer's process-wide point cloud/mesh "session" (was module-level state, which does not
 * survive serverless instances). Single row, id = "global". points/mesh are the API-shaped JSON.
 */
export const visualizerSessions = pgTable("visualizer_sessions", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  pointCount: integer("point_count").notNull().default(0),
  points: jsonb("points").notNull().default(sql`'[]'::jsonb`),
  mesh: jsonb("mesh"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Legacy `projects/{p}/devices/{d}/scans/{scanId}` docs written by the scan-calibration
 * routes (uploaded and combined calibration scans). Kept separate from the scans domain's table.
 */
export const scanCalibrationRecords = pgTable(
  "scan_calibration_records",
  {
    id: text("id").primaryKey(), // scanId
    projectId: text("project_id").notNull(),
    deviceId: text("device_id").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    objUrl: text("obj_url"),
    error: text("error"),
    isUploadedCalibrationScan: boolean("is_uploaded_calibration_scan").notNull().default(false),
    isCombinedCalibrationScan: boolean("is_combined_calibration_scan").notNull().default(false),
    originalFileName: text("original_file_name"),
    outputName: text("output_name"),
    scalarMmPerPixel: doublePrecision("scalar_mm_per_pixel"),
    sourceScanIds: text("source_scan_ids").array(),
    combineTransforms: jsonb("combine_transforms"),
  },
  (t) => [index("scan_calibration_records_proj_dev_idx").on(t.projectId, t.deviceId)],
);

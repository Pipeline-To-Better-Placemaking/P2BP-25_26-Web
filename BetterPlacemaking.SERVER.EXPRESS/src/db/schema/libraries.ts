import { doublePrecision, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// user_id / project_id are intentionally plain text (no FK): library items are
// scoped by the caller's JWT subject, mirroring the database docs.

/** Legacy `board_library` (saved ChArUco/ArUco calibration board presets). */
export const boardLibrary = pgTable(
  "board_library",
  {
    id: id(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    nickname: text("nickname").notNull(),
    dictionary: text("dictionary").notNull(),
    units: text("units").notNull(),
    cols: integer("cols"),
    rows: integer("rows"),
    markerId: integer("marker_id"),
    squareSize: doublePrecision("square_size"),
    markerSize: doublePrecision("marker_size").notNull(),
    squareSizeMm: doublePrecision("square_size_mm"),
    markerSizeMm: doublePrecision("marker_size_mm").notNull(),
    previewSvg: text("preview_svg").notNull(),
    createdAtUtc: ts("created_at_utc").notNull().defaultNow(),
  },
  (t) => [index("board_library_user_idx").on(t.userId)],
);

export interface FloorplanCalibrationJson {
  ReferencePointsFlat?: number[] | null;
  ReferenceDistanceMm: number;
  MmPerPixel: number;
  OriginFp?: number[] | null;
  CalibratedAtUtc: string;
}

/** Legacy `floorplan_library` (uploaded floorplan images + optional scale calibration). */
export const floorplanLibrary = pgTable(
  "floorplan_library",
  {
    id: id(),
    userId: text("user_id").notNull(),
    projectId: text("project_id"),
    nickname: text("nickname"),
    imagePath: text("image_path"),
    imageContentType: text("image_content_type"),
    imageSizeBytes: integer("image_size_bytes").notNull(),
    imageWidth: integer("image_width").notNull(),
    imageHeight: integer("image_height").notNull(),
    calibration: jsonb("calibration").$type<FloorplanCalibrationJson>(),
    createdAtUtc: ts("created_at_utc").notNull().defaultNow(),
    updatedAtUtc: ts("updated_at_utc").notNull().defaultNow(),
  },
  (t) => [index("floorplan_library_user_idx").on(t.userId, t.projectId)],
);

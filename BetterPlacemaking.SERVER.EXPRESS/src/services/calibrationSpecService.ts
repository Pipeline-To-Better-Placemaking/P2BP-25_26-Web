import { and, desc, eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { getDb } from "../db/client.js";
import { floorplanLibrary, projects } from "../db/schema/index.js";
import { createSignedDownloadUrl } from "./cloudStorageService.js";
import { WORKSTATION_TICKET_AUDIENCE } from "./workstationTicketService.js";
export const CALIBRATION_SPEC_SCOPE = "amc-calibration-spec";
export const CALIBRATION_SPEC_MINUTES = 15;

export class ProjectNotFoundError extends Error {}
export class FloorplanNotInProjectError extends Error {}

export interface CalibrationSpecFloorplan {
  id: string;
  nickname: string | null;
  url: string;
  contentType: string | null;
  width: number;
  height: number;
  /** AMC's layout_px_per_m, from the floor plan's scale calibration; null if not calibrated. */
  pxPerM: number | null;
}

export interface CalibrationSpec {
  title: string;
  floorplan: CalibrationSpecFloorplan | null;
}

export interface CreatedCalibrationSpec {
  token: string;
  expiresAtUtc: Date;
  spec: CalibrationSpec;
}

export function pxPerMetre(mmPerPixel: unknown): number | null {
  return typeof mmPerPixel === "number" && Number.isFinite(mmPerPixel) && mmPerPixel > 0
    ? Math.round((1000 / mmPerPixel) * 10_000) / 10_000
    : null;
}

async function loadFloorplan(projectId: string, floorplanId?: string) {
  const conditions = [eq(floorplanLibrary.projectId, projectId)];
  if (floorplanId) conditions.push(eq(floorplanLibrary.id, floorplanId));
  const [row] = await getDb()
    .select()
    .from(floorplanLibrary)
    .where(and(...conditions))
    .orderBy(desc(floorplanLibrary.updatedAtUtc))
    .limit(1);
  if (floorplanId && !row) throw new FloorplanNotInProjectError("That floor plan is not attached to this project.");
  return row ?? null;
}

export async function createCalibrationSpec(
  userId: string,
  projectId: string,
  floorplanId?: string,
): Promise<CreatedCalibrationSpec> {
  const secret = env.workstationTicketSecret;
  if (!secret) throw new Error("WORKSTATION_TICKET_SECRET is not configured.");

  const [project] = await getDb().select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new ProjectNotFoundError("Project not found.");

  const row = await loadFloorplan(projectId, floorplanId);
  let floorplan: CalibrationSpecFloorplan | null = null;
  if (row?.imagePath) {
    const signed = await createSignedDownloadUrl({
      PathFromRoot: row.imagePath,
      TtlSeconds: CALIBRATION_SPEC_MINUTES * 60,
    });
    floorplan = {
      id: row.id,
      nickname: row.nickname,
      url: signed.SignedUrl,
      contentType: row.imageContentType,
      width: row.imageWidth,
      height: row.imageHeight,
      pxPerM: pxPerMetre(row.calibration?.MmPerPixel),
    };
  }

  const spec: CalibrationSpec = { title: project.title?.trim() || project.id, floorplan };
  const expiresAtUtc = new Date(Date.now() + CALIBRATION_SPEC_MINUTES * 60_000);
  const token = jwt.sign({ sub: userId, pid: projectId, scope: CALIBRATION_SPEC_SCOPE, spec }, secret, {
    algorithm: "HS256",
    audience: WORKSTATION_TICKET_AUDIENCE,
    issuer: env.jwtIssuer,
    expiresIn: `${CALIBRATION_SPEC_MINUTES}m`,
  });
  return { token, expiresAtUtc, spec };
}

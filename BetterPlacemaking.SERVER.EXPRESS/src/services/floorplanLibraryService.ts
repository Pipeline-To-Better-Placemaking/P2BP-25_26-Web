import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { floorplanLibrary } from "../db/schema/index.js";
import { uploadObject } from "./cloudStorageService.js";
import {
  unflattenReferencePoints,
  type FloorplanCalibrationDoc,
  type FloorplanLibraryItem,
} from "../models/floorplanLibrary.js";

/** Mirrors ArgumentException usage in FloorplanLibraryService.cs (-> 400 Bad Request). */
export class FloorplanValidationError extends Error {}

/** Mirrors KeyNotFoundException usage in FloorplanLibraryService.cs (-> 404 Not Found). */
export class FloorplanNotFoundError extends Error {}

function toItem(row: typeof floorplanLibrary.$inferSelect): FloorplanLibraryItem {
  return {
    Id: row.id,
    UserId: row.userId,
    ProjectId: row.projectId,
    Nickname: row.nickname,
    ImagePath: row.imagePath,
    ImageContentType: row.imageContentType,
    ImageSizeBytes: row.imageSizeBytes,
    ImageWidth: row.imageWidth,
    ImageHeight: row.imageHeight,
    Calibration: row.calibration ?? null,
    CreatedAtUtc: row.createdAtUtc.toISOString(),
    UpdatedAtUtc: row.updatedAtUtc.toISOString(),
  };
}

function cleanNullable(value?: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

/** Lists items for a user (newest-updated first), optionally filtered by project. */
export async function listForUser(userId: string, projectId?: string | null): Promise<FloorplanLibraryItem[]> {
  if (!userId?.trim()) return [];
  const normalizedProjectId = cleanNullable(projectId);
  const rows = await getDb()
    .select()
    .from(floorplanLibrary)
    .where(
      normalizedProjectId
        ? and(eq(floorplanLibrary.userId, userId), eq(floorplanLibrary.projectId, normalizedProjectId))
        : eq(floorplanLibrary.userId, userId),
    )
    .orderBy(desc(floorplanLibrary.updatedAtUtc));
  return rows.map(toItem);
}

export async function getByIdForUser(userId: string, id: string): Promise<FloorplanLibraryItem | null> {
  if (!userId?.trim() || !id?.trim()) return null;
  const [row] = await getDb()
    .select()
    .from(floorplanLibrary)
    .where(and(eq(floorplanLibrary.id, id), eq(floorplanLibrary.userId, userId)));
  return row ? toItem(row) : null;
}

function normalizeImageContentType(rawContentType?: string | null): string {
  const contentType = (rawContentType ?? "").trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new FloorplanValidationError("The uploaded file must be an image.");
  }
  return contentType;
}

function extensionOf(fileName?: string | null): string {
  const match = /\.[^./\\]+$/.exec(fileName ?? "");
  return match ? match[0].toLowerCase() : "";
}

function normalizeImageExtension(fileName: string | null | undefined, contentType: string): string {
  const ext = extensionOf(fileName);
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") return ext;

  switch (contentType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    default:
      throw new FloorplanValidationError("Unsupported floorplan image type.");
  }
}

function normalizeNickname(rawNickname: string | null | undefined, fallbackFileName: string): string {
  let cleaned = (rawNickname ?? "").trim();
  if (cleaned.length > 120) cleaned = cleaned.slice(0, 120).trim();
  if (cleaned) return cleaned;

  const withoutExt = fallbackFileName.slice(0, fallbackFileName.length - extensionOf(fallbackFileName).length).trim();
  const fallback = withoutExt.length > 120 ? withoutExt.slice(0, 120).trim() : withoutExt;
  if (fallback) return fallback;

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `Floorplan ${stamp}`;
}

/**
 * Ported from FloorplanLibraryService.ReadImageDimensions: reads width/height
 * straight from PNG/JPEG/WebP file headers, no native image libraries.
 * Returns { width: 0, height: 0 } if the format is unrecognized or the header
 * is truncated - callers treat that as "not a valid image".
 */
function readImageDimensions(bytes: Buffer, contentType: string): { width: number; height: number } {
  if (bytes.length < 24) return { width: 0, height: 0 };

  // PNG: 8-byte signature, then IHDR chunk; width @16, height @20, big-endian.
  if (contentType.includes("png") && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  // JPEG: scan for SOF0/SOF1/SOF2 markers (FF C0 / FF C1 / FF C2).
  if ((contentType.includes("jpeg") || contentType.includes("jpg")) && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 8 < bytes.length) {
      if (bytes[i] !== 0xff) break;
      const marker = bytes[i + 1];
      const segLen = (bytes[i + 2] << 8) | bytes[i + 3];

      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6];
        const width = (bytes[i + 7] << 8) | bytes[i + 8];
        return { width, height };
      }

      i += 2 + segLen;
    }
    return { width: 0, height: 0 };
  }

  // WebP: RIFF....WEBP VP8 (lossy) header carries dimensions; VP8L/VP8X use a 1x1 sentinel.
  if (contentType.includes("webp") && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    if (bytes.length >= 30 && bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x20) {
      const width = ((bytes[26] | (bytes[27] << 8)) & 0x3fff) + 1;
      const height = ((bytes[28] | (bytes[29] << 8)) & 0x3fff) + 1;
      return { width, height };
    }
    return { width: 1, height: 1 };
  }

  return { width: 0, height: 0 };
}

function buildObjectPath(userId: string, projectId: string, docId: string, fileName: string | null | undefined, extension: string): string {
  const withoutExt = (fileName ?? "floorplan").slice(0, (fileName ?? "floorplan").length - extensionOf(fileName).length);
  return `users/${userId}/floorplans/${projectId}/${docId}_${withoutExt}${extension}`;
}

export interface UploadFloorplanInput {
  ImageBuffer: Buffer;
  FileName?: string | null;
  ContentType?: string | null;
  Nickname?: string | null;
  ProjectId?: string | null;
}

export async function uploadForUser(userId: string, input: UploadFloorplanInput): Promise<FloorplanLibraryItem> {
  if (!userId?.trim()) throw new FloorplanValidationError("Missing user id.");
  if (!input.ImageBuffer || input.ImageBuffer.length <= 0) {
    throw new FloorplanValidationError("A floorplan image is required.");
  }

  const contentType = normalizeImageContentType(input.ContentType);
  const extension = normalizeImageExtension(input.FileName, contentType);
  const normalizedProjectId = cleanNullable(input.ProjectId) ?? "shared";

  const { width, height } = readImageDimensions(input.ImageBuffer, contentType);
  if (width === 0 || height === 0) {
    throw new FloorplanValidationError("The uploaded file is not a valid or supported image.");
  }

  const docId = crypto.randomUUID();
  const objectPath = buildObjectPath(userId, normalizedProjectId, docId, input.FileName, extension);

  // Uploads the image bytes to Supabase Storage (mirrors CloudStorageService.UploadFromStreamAsync).
  await uploadObject(objectPath, contentType, input.ImageBuffer);

  const now = new Date();
  const [row] = await getDb()
    .insert(floorplanLibrary)
    .values({
      id: docId,
      userId,
      projectId: cleanNullable(input.ProjectId),
      nickname: normalizeNickname(input.Nickname, input.FileName ?? "Floorplan"),
      imagePath: objectPath,
      imageContentType: contentType,
      imageSizeBytes: input.ImageBuffer.length,
      imageWidth: width,
      imageHeight: height,
      calibration: null,
      createdAtUtc: now,
      updatedAtUtc: now,
    })
    .returning();
  return toItem(row);
}

export interface UpdateFloorplanInput {
  Nickname?: string | null;
  ProjectId?: string | null;
  ReferencePoints?: number[][] | null;
  ReferenceDistanceMm?: number | null;
  MmPerPixel?: number | null;
  OriginFp?: number[] | null;
}

function mergeCalibration(existing: FloorplanLibraryItem, input: UpdateFloorplanInput): FloorplanCalibrationDoc | null {
  const calibrationTouched =
    input.ReferencePoints != null ||
    input.ReferenceDistanceMm != null ||
    input.MmPerPixel != null ||
    input.OriginFp != null;

  if (!calibrationTouched) return existing.Calibration ?? null;

  const existingCalibration = existing.Calibration ?? null;
  const referencePoints = input.ReferencePoints ?? unflattenReferencePoints(existingCalibration?.ReferencePointsFlat);
  const referenceDistanceMm = input.ReferenceDistanceMm ?? existingCalibration?.ReferenceDistanceMm;

  if (!referencePoints || referencePoints.length !== 2 || referencePoints.some((p) => !p || p.length < 2)) {
    throw new FloorplanValidationError("ReferencePoints must contain exactly two [x, y] points.");
  }

  let mmPerPixel: number;
  if (input.MmPerPixel != null) {
    mmPerPixel = input.MmPerPixel;
  } else {
    if (!referenceDistanceMm || referenceDistanceMm <= 0) {
      throw new FloorplanValidationError("ReferenceDistanceMm must be greater than 0.");
    }
    const dx = referencePoints[1][0] - referencePoints[0][0];
    const dy = referencePoints[1][1] - referencePoints[0][1];
    const distancePixels = Math.sqrt(dx * dx + dy * dy);
    if (distancePixels <= 0) {
      throw new FloorplanValidationError("ReferencePoints must be distinct.");
    }
    mmPerPixel = referenceDistanceMm / distancePixels;
  }

  if (mmPerPixel <= 0) {
    throw new FloorplanValidationError("MmPerPixel must be greater than 0.");
  }

  const originFp = input.OriginFp ?? existingCalibration?.OriginFp ?? [0, existing.ImageHeight - 1.0];
  if (originFp.length < 2) {
    throw new FloorplanValidationError("OriginFp must contain two numeric values.");
  }

  return {
    ReferencePointsFlat: referencePoints.flatMap((p) => [p[0], p[1]]),
    ReferenceDistanceMm: referenceDistanceMm ?? existingCalibration?.ReferenceDistanceMm ?? 0,
    MmPerPixel: mmPerPixel,
    OriginFp: [originFp[0], originFp[1]],
    CalibratedAtUtc: new Date().toISOString(),
  };
}

/** Full-field overwrite of Nickname/ProjectId/Calibration, matching the ASP.NET server's SetAsync-based update. */
export async function updateForUser(userId: string, id: string, input: UpdateFloorplanInput): Promise<FloorplanLibraryItem> {
  if (!userId?.trim()) throw new FloorplanValidationError("Missing user id.");
  if (!id?.trim()) throw new FloorplanValidationError("id is required.");

  const existing = await getByIdForUser(userId, id);
  if (!existing) throw new FloorplanNotFoundError("Floorplan not found.");

  const [row] = await getDb()
    .update(floorplanLibrary)
    .set({
      projectId: input.ProjectId != null ? cleanNullable(input.ProjectId) : existing.ProjectId,
      nickname:
        input.Nickname != null ? normalizeNickname(input.Nickname, existing.Nickname ?? existing.Id) : existing.Nickname,
      calibration: mergeCalibration(existing, input),
      updatedAtUtc: new Date(),
    })
    .where(and(eq(floorplanLibrary.id, id), eq(floorplanLibrary.userId, userId)))
    .returning();
  if (!row) throw new FloorplanNotFoundError("Floorplan not found.");
  return toItem(row);
}

export async function deleteForUser(userId: string, id: string): Promise<boolean> {
  if (!userId?.trim() || !id?.trim()) return false;
  const deleted = await getDb()
    .delete(floorplanLibrary)
    .where(and(eq(floorplanLibrary.id, id), eq(floorplanLibrary.userId, userId)))
    .returning({ id: floorplanLibrary.id });
  return deleted.length > 0;
}

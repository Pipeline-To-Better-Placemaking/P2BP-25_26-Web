import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { cameraIntrinsics, intrinsicsSightings } from "../db/schema/index.js";
import {
  flattenCameraMatrix,
  hasCameraMatrix,
  toIntrinsicsResultDto,
  type CameraIntrinsics,
  type IntrinsicsResultResponseDto,
  type IntrinsicsSightingsResponseDto,
  type SubmitIntrinsicsResultDto,
  type SubmitIntrinsicsSightingsDto,
} from "../models/intrinsics.js";

function toCameraIntrinsics(row: typeof cameraIntrinsics.$inferSelect): CameraIntrinsics {
  return {
    Id: row.id,
    ModelId: row.modelId,
    DeviceId: row.deviceId,
    CameraMac: row.cameraMac,
    IsPerUnit: row.isPerUnit,
    CameraMatrixFlat: row.cameraMatrixFlat,
    DistortionCoefficients: row.distortionCoefficients,
    ReprojectionError: row.reprojectionError as number,
    SightingsUsed: row.sightingsUsed as number,
    ComputedAtUnix: row.computedAtUnix as number,
  };
}

function normalizeMac(mac?: string | null): string {
  return (mac ?? "").trim().toLowerCase();
}

/**
 * Mirrors IntrinsicsService.SubmitSightings: one row per sighting, inserted together in a
 * single transaction (the equivalent of the database batch write it replaced).
 */
export async function submitSightings(
  deviceId: string,
  dto: SubmitIntrinsicsSightingsDto,
): Promise<IntrinsicsSightingsResponseDto> {
  const mac = normalizeMac(dto.CameraMac);

  const rows = (dto.Sightings ?? []).map((s) => {
    const sanitizedCapturedAt = (s.CapturedAt ?? "").replace(/:/g, "-").replace(/\+/g, "p");
    const docId = `${deviceId}_${mac}_${sanitizedCapturedAt}_${crypto.randomUUID().replace(/-/g, "")}`;
    return {
      id: docId,
      modelId: dto.IsPerUnit ? null : (dto.ModelId ?? null),
      deviceId,
      cameraMac: mac,
      isPerUnit: !!dto.IsPerUnit,
      capturedAt: s.CapturedAt ?? null,
      imagePoints: s.ImagePoints ?? null,
      cornerIds: s.CornerIds ?? null,
      frameSize: s.FrameSize ?? null,
      rmse: s.Rmse ?? null,
    };
  });

  await getDb().transaction(async (tx) => {
    if (rows.length > 0) await tx.insert(intrinsicsSightings).values(rows);
  });

  return { SightingsStored: rows.length };
}

/** Mirrors IntrinsicsService.StoreResult - doc id is per-unit ("{deviceId}_{mac}") or model-level (ModelId, falling back to mac). */
export async function storeResult(
  deviceId: string,
  dto: SubmitIntrinsicsResultDto,
): Promise<IntrinsicsResultResponseDto> {
  const mac = normalizeMac(dto.CameraMac);
  const docId = dto.IsPerUnit ? `${deviceId}_${mac}` : (dto.ModelId ?? mac);

  const values = {
    modelId: dto.IsPerUnit ? null : (dto.ModelId ?? null),
    deviceId: dto.IsPerUnit ? deviceId : null,
    cameraMac: dto.IsPerUnit ? mac : null,
    isPerUnit: !!dto.IsPerUnit,
    cameraMatrixFlat: flattenCameraMatrix(dto.CameraMatrix ?? []),
    distortionCoefficients: dto.DistortionCoefficients ?? [],
    reprojectionError: dto.ReprojectionError,
    sightingsUsed: dto.SightingsUsed,
    computedAtUnix: Math.floor(Date.now() / 1000),
  };

  const [row] = await getDb()
    .insert(cameraIntrinsics)
    .values({ id: docId, ...values })
    .onConflictDoUpdate({ target: cameraIntrinsics.id, set: values })
    .returning();
  return toIntrinsicsResultDto(toCameraIntrinsics(row));
}

/** Mirrors IntrinsicsService.GetIntrinsics - the per-unit record takes priority, falling back to the model-level one. */
export async function getIntrinsics(
  deviceId: string,
  mac: string,
  modelId?: string | null,
): Promise<IntrinsicsResultResponseDto | null> {
  const normMac = normalizeMac(mac);
  const perUnitId = `${deviceId}_${normMac}`;
  const [perUnitRow] = await getDb().select().from(cameraIntrinsics).where(eq(cameraIntrinsics.id, perUnitId)).limit(1);
  if (perUnitRow) {
    const record = toCameraIntrinsics(perUnitRow);
    if (hasCameraMatrix(record)) {
      return toIntrinsicsResultDto(record);
    }
  }

  if (modelId?.trim()) {
    return getModelIntrinsics(modelId);
  }

  return null;
}

/** Mirrors IntrinsicsService.GetModelIntrinsics. */
export async function getModelIntrinsics(modelId: string): Promise<IntrinsicsResultResponseDto | null> {
  const [row] = await getDb().select().from(cameraIntrinsics).where(eq(cameraIntrinsics.id, modelId)).limit(1);
  if (!row) return null;

  const record = toCameraIntrinsics(row);
  if (!hasCameraMatrix(record)) return null;

  return toIntrinsicsResultDto(record);
}

/**
 * Camera intrinsic calibration parameters - pure CRUD storage of values a device
 * (or its calibration routine) computes and submits. Ported from
 * BetterPlacemaking.SERVER/Models/Homography/{CameraIntrinsics,IntrinsicsSighting}.cs
 * and the Intrinsics-related records in Models/Dtos/HomographyDtos.cs. No
 * calibration math (deriving CameraMatrix/DistortionCoefficients from corner
 * sightings) runs on this server - that happens on the device; this module only
 * stores/retrieves the numbers it is given.
 */

export interface IntrinsicsSightingDto {
  CornerCount: number;
  ImagePoints: number[][]; // [[x,y], ...]
  CornerIds: number[];
  FrameSize: number[]; // [width, height]
  Rmse: number;
  CapturedAt: string;
}

export interface SubmitIntrinsicsSightingsDto {
  CameraMac: string;
  IsPerUnit: boolean;
  ModelId?: string | null;
  Sightings: IntrinsicsSightingDto[];
}

export interface IntrinsicsSightingsResponseDto {
  SightingsStored: number;
}

export interface SubmitIntrinsicsResultDto {
  CameraMac: string;
  IsPerUnit: boolean;
  ModelId?: string | null;
  CameraMatrix: number[][]; // 3x3
  DistortionCoefficients: number[];
  ReprojectionError: number;
  SightingsUsed: number;
}

export interface IntrinsicsResultResponseDto {
  Id: string;
  CameraMac?: string | null;
  ModelId?: string | null;
  IsPerUnit: boolean;
  CameraMatrix: number[][];
  DistortionCoefficients: number[];
  ReprojectionError: number;
  SightingsUsed: number;
  ComputedAtUnix: number;
}

/** Document shape for the `intrinsics_sightings` collection. */
export interface IntrinsicsSightingDoc {
  ModelId?: string | null; // null for per-unit
  DeviceId?: string | null;
  CameraMac?: string | null;
  IsPerUnit: boolean;
  CapturedAt?: string | null;
  ImagePoints?: number[][] | null; // [[x,y], ...]
  CornerIds?: number[] | null;
  FrameSize?: number[] | null; // [width, height]
  Rmse: number;
}

/**
 * Document shape for the `camera_intrinsics` collection. The old document store did not
 * support arrays nested directly inside arrays, so - exactly as the C#
 * CameraIntrinsics model does - the 3x3 CameraMatrix is flattened to 9 elements
 * for storage and unflattened on read via flattenCameraMatrix/unflattenCameraMatrix.
 */
export interface CameraIntrinsicsDoc {
  ModelId?: string | null;
  DeviceId?: string | null; // null for model-level
  CameraMac?: string | null; // null for model-level
  IsPerUnit: boolean;
  CameraMatrixFlat?: number[] | null;
  DistortionCoefficients?: number[] | null;
  ReprojectionError: number;
  SightingsUsed: number;
  ComputedAtUnix: number;
}

export interface CameraIntrinsics extends CameraIntrinsicsDoc {
  Id: string;
}

export function flattenCameraMatrix(matrix: number[][]): number[] {
  return matrix.flat();
}

/** Mirrors the C# CameraMatrix getter: only returns a matrix when exactly 9 flat values are present. */
export function unflattenCameraMatrix(flat?: number[] | null): number[][] | null {
  if (!flat || flat.length !== 9) return null;
  return [flat.slice(0, 3), flat.slice(3, 6), flat.slice(6, 9)];
}

export function hasCameraMatrix(doc: CameraIntrinsicsDoc): boolean {
  return unflattenCameraMatrix(doc.CameraMatrixFlat) !== null;
}

/** Mirrors IntrinsicsService.ToResponseDto. Callers must check hasCameraMatrix first. */
export function toIntrinsicsResultDto(record: CameraIntrinsics): IntrinsicsResultResponseDto {
  return {
    Id: record.Id,
    CameraMac: record.CameraMac ?? null,
    ModelId: record.ModelId ?? null,
    IsPerUnit: record.IsPerUnit,
    CameraMatrix: unflattenCameraMatrix(record.CameraMatrixFlat) ?? [],
    DistortionCoefficients: record.DistortionCoefficients ?? [],
    ReprojectionError: record.ReprojectionError,
    SightingsUsed: record.SightingsUsed,
    ComputedAtUnix: record.ComputedAtUnix,
  };
}

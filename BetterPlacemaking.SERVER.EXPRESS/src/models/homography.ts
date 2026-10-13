/**
 * Homography resource - camera-pixel-space <-> world-space calibration.
 *
 * Ported from BetterPlacemaking.SERVER/Models/Homography/{LocalHomography,
 * LockedHomography,ArUcoScanSession,ArUcoSighting,PuzzlePieceArtifact,
 * ProjectGlobalHomographySet}.cs and Models/Dtos/HomographyDtos.cs.
 *
 * As in CameraIntrinsics (see models/intrinsics.ts), Firestore does not support
 * arrays nested directly inside arrays, so every 3x3 matrix is stored flattened
 * to 9 elements (`*Flat`) and un/flattened at the model boundary via
 * flattenMatrix3x3 / unflattenMatrix3x3 below - same strategy the C# types use
 * via their `MatrixFlat` field + computed `Matrix` property.
 */

export type Matrix3x3 = number[][];

/** Mirrors the `Matrix` (etc.) setter on the C# Firestore models: `value?.SelectMany(r => r).ToList()`. */
export function flattenMatrix3x3(m: Matrix3x3 | null | undefined): number[] | null {
  return m ? m.flat() : null;
}

/** Mirrors the `Matrix` (etc.) getter: only returns a matrix when exactly 9 flat values are present. */
export function unflattenMatrix3x3(flat?: number[] | null): Matrix3x3 | null {
  if (!flat || flat.length !== 9) return null;
  return [flat.slice(0, 3), flat.slice(3, 6), flat.slice(6, 9)];
}

/** Mirrors ArUcoMarkerRecord.CornersPx setter: flattens each [x,y] pair in order. */
export function flattenPointPairs(points: number[][] | null | undefined): number[] | null {
  return points ? points.flat() : null;
}

/** Mirrors ArUcoMarkerRecord.CornersPx getter: requires an even count of >= 2 flat values. */
export function unflattenPointPairs(flat?: number[] | null): number[][] | null {
  if (!flat || flat.length < 2 || flat.length % 2 !== 0) return null;
  const result: number[][] = [];
  for (let i = 0; i < flat.length; i += 2) result.push([flat[i], flat[i + 1]]);
  return result;
}

// ---------------------------------------------------------------------------
// Firestore doc shapes
// ---------------------------------------------------------------------------

/** Firestore doc shape for the `local_homographies` collection (id: "{deviceId}_{cameraMac}"). */
export interface LocalHomographyDoc {
  DeviceId?: string | null;
  CameraMac?: string | null;
  MatrixFlat?: number[] | null;
  FrameSize?: number[] | null; // [width, height]
  Inliers: number;
  RmseBoard: number;
  CornersUsed: number;
  MarkersDetected: number;
  ArucoDict?: string | null;
  SquaresX: number;
  SquaresY: number;
  SquareLength: number;
  MarkerLength: number;
  TimestampUnix: number;
  SnapshotPath?: string | null;
  CameraMatrixFlat?: number[] | null;
  DistortionCoefficients?: number[] | null;
  UsedUndistortedImage?: boolean | null;
}

export interface LocalHomography extends LocalHomographyDoc {
  Id: string;
}

/** Firestore doc shape for the `locked_homographies` collection (id: "{deviceId}_{cameraMac}"). */
export interface LockedHomographyDoc {
  DeviceId?: string | null;
  CameraMac?: string | null;
  MatrixFlat?: number[] | null;
  ComputedAt: Date;
}

export interface LockedHomography extends LockedHomographyDoc {
  Id: string;
}

/** Firestore doc shape for the `aruco_sessions` collection (auto id). */
export interface ArUcoScanSessionDoc {
  ArucoDict?: string | null;
  Status: string; // collecting -> computing -> done | failed
  CamerasCheckedIn?: string[] | null;
  CamerasTotal: number;
  CreatedAt: Date;
}

export interface ArUcoScanSession extends ArUcoScanSessionDoc {
  Id: string;
}

export interface ArUcoMarkerRecordDoc {
  MarkerId: number;
  CornersPxFlat?: number[] | null;
}

/** Firestore doc shape for the `aruco_sightings` collection (id: "{sessionId}_{cameraMac}"). */
export interface ArUcoSightingDoc {
  SessionId?: string | null;
  DeviceId?: string | null;
  CameraMac?: string | null;
  ArucoDict?: string | null;
  CapturedAt?: string | null;
  Markers?: ArUcoMarkerRecordDoc[] | null;
  LocalHomographyHash?: string | null;
}

export interface ArUcoSighting extends ArUcoSightingDoc {
  Id: string;
}

/** Firestore doc shape for the `puzzle_pieces` collection (id: "{projectId}__{deviceId}__{cameraMac with ':' -> '_'}"). */
export interface PuzzlePieceArtifactDoc {
  ProjectId?: string | null;
  DeviceId?: string | null;
  CameraMac?: string | null;
  LocalHomographyId?: string | null;
  LocalHomographyHash?: string | null;
  LocalHomographyMatrixFlat?: number[] | null;
  HLocalCanvasFlat?: number[] | null;
  SourceFrameSize?: number[] | null;
  PuzzlePieceSize?: number[] | null;
  SourceSnapshotPath?: string | null;
  UsedUndistortedImage: boolean;
  UndistortMode?: string | null;
  BboxTrimPct: number;
  HomographyFile?: string | null;
  PuzzlePiecePath?: string | null;
  MetadataPath?: string | null;
  GenerationVersion: number;
  GeneratedAt: Date;
}

export interface PuzzlePieceArtifact extends PuzzlePieceArtifactDoc {
  Id: string;
}

export interface GlobalHomographyPlacementRecord {
  PuzzlePieceId?: string | null;
  DeviceId?: string | null;
  CameraMac?: string | null;
  CenterFp?: number[] | null;
  AngleDeg: number;
  Scale: number;
  HLocalCanvasFlat?: number[] | null;
  LocalCanvasSize?: number[] | null;
  GlobalHomographyFloorplanFlat?: number[] | null;
  GlobalHomographyFlat?: number[] | null;
}

export interface HomographyLockGroupRecord {
  GroupId?: string | null;
  CameraMacs?: string[] | null;
}

/** Firestore doc shape for the `global_homographies` collection (id: projectId). */
export interface ProjectGlobalHomographySetDoc {
  ProjectId?: string | null;
  FloorplanId?: string | null;
  MmPerFpPx: number;
  OriginFp?: number[] | null;
  FloorplanSize?: number[] | null;
  Placements?: GlobalHomographyPlacementRecord[] | null;
  LockedGroups?: HomographyLockGroupRecord[] | null;
  SavedByUserId?: string | null;
  SavedAt: Date;
}

export interface ProjectGlobalHomographySet extends ProjectGlobalHomographySetDoc {
  Id: string;
}

// ---------------------------------------------------------------------------
// Wire DTOs - ported field-for-field (PascalCase) from Models/Dtos/HomographyDtos.cs
// ---------------------------------------------------------------------------

export interface SubmitLocalHomographyDto {
  CameraMac: string;
  Matrix: Matrix3x3;
  FrameSize: number[];
  Inliers: number;
  RmseBoard: number;
  CornersUsed: number;
  MarkersDetected: number;
  ArucoDict: string;
  SquaresX: number;
  SquaresY: number;
  SquareLength: number;
  MarkerLength: number;
  TimestampUnix: number;
  SnapshotPath?: string | null;
  CameraMatrix?: Matrix3x3 | null;
  DistortionCoefficients?: number[] | null;
  UsedUndistortedImage?: boolean | null;
}

export interface LocalHomographyResponseDto {
  HomographyId: string;
  CameraMac: string;
}

export interface ArucoMarkerSightingDto {
  MarkerId: number;
  CornersPx: number[][];
}

export interface SubmitArucoSightingsDto {
  CameraMac: string;
  ArucoDict: string;
  CapturedAt: string;
  Markers: ArucoMarkerSightingDto[];
  SessionId?: string | null;
  LocalHomographyHash?: string | null;
}

export interface ArucoSightingsResponseDto {
  SessionId: string;
  Status: string;
  CamerasCheckedIn: string[];
  CamerasTotal: number;
}

export interface CameraIntrinsicsResponseDto {
  CameraMac: string;
  CameraMatrix: Matrix3x3;
  DistortionCoefficients: number[];
  TimestampUnix: number;
}

export interface ComputeLockResponseDto {
  Status: string;
  CamerasComputed: number;
}

export interface SessionStatusResponseDto {
  SessionId: string;
  Status: string;
  CamerasCheckedIn: string[];
  CamerasTotal: number;
  CreatedAt: string;
}

export interface PuzzlePieceMetadataDto {
  PuzzlePieceId: string;
  DeviceId: string;
  CameraMac: string;
  LocalHomographyId: string;
  LocalHomographyHash: string;
  HLocalCanvas: Matrix3x3;
  SourceFrameSize: number[];
  PuzzlePieceSize: number[];
  SourceSnapshotPath?: string | null;
  UsedUndistortedImage: boolean;
  UndistortMode: string;
  BboxTrimPct: number;
  HomographyFile: string;
  MetadataPath?: string | null;
  MetadataDownloadUrl?: string | null;
  MetadataDownloadUrlExpiresAt?: string | null;
  GeneratedAt: string;
}

export interface PuzzlePieceDto {
  PuzzlePieceId: string;
  DeviceId: string;
  CameraMac: string;
  Status: string;
  PuzzlePiecePath?: string | null;
  PuzzlePieceDownloadUrl?: string | null;
  PuzzlePieceDownloadUrlExpiresAt?: string | null;
  Metadata?: PuzzlePieceMetadataDto | null;
  Error?: string | null;
}

export interface LocalHomographyWorkspaceDto {
  HomographyId: string;
  DeviceId: string;
  CameraMac: string;
  Matrix: Matrix3x3;
  FrameSize: number[];
  TimestampUnix: number;
  SnapshotPath?: string | null;
  UsedUndistortedImage?: boolean | null;
  LocalHomographyHash: string;
}

export interface HomographyLockGroupDto {
  GroupId: string;
  CameraMacs: string[];
}

export interface GlobalHomographyPlacementDto {
  PuzzlePieceId: string;
  DeviceId: string;
  CameraMac: string;
  CenterFp: number[];
  AngleDeg: number;
  Scale: number;
  HLocalCanvas: Matrix3x3;
  LocalCanvasSize: number[];
  GlobalHomographyFloorplan: Matrix3x3;
  GlobalHomography: Matrix3x3;
}

export interface GlobalHomographySetDto {
  ProjectId: string;
  FloorplanId?: string | null;
  MmPerFpPx: number;
  OriginFp: number[];
  FloorplanSize: number[];
  Placements: GlobalHomographyPlacementDto[];
  LockedGroups: HomographyLockGroupDto[];
  SavedAt: string;
  SavedByUserId?: string | null;
}

export interface PuzzleWorkspaceResponseDto {
  ProjectId: string;
  PuzzlePieces: PuzzlePieceDto[];
  PuzzlePieceMetaFiles: PuzzlePieceMetadataDto[];
  LocalHomographies: LocalHomographyWorkspaceDto[];
  GlobalHomographies?: GlobalHomographySetDto | null;
  LockedGroups: HomographyLockGroupDto[];
}

export interface SaveGlobalHomographyPlacementDto {
  PuzzlePieceId: string;
  DeviceId: string;
  CameraMac: string;
  CenterFp: number[];
  AngleDeg: number;
  Scale: number;
  HLocalCanvas: Matrix3x3;
  LocalCanvasSize: number[];
}

export interface SaveGlobalHomographiesDto {
  FloorplanId?: string | null;
  MmPerFpPx: number;
  OriginFp: number[];
  FloorplanSize: number[];
  Placements: SaveGlobalHomographyPlacementDto[];
  LockedGroups?: HomographyLockGroupDto[] | null;
}

export interface SaveGlobalHomographiesResponseDto {
  ProjectId: string;
  PlacementsSaved: number;
  SavedAt: string;
  GlobalHomographies: GlobalHomographySetDto;
}

import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  arucoSessions,
  arucoSightings,
  devices,
  globalHomographies,
  localHomographies,
  lockedHomographies,
  puzzlePieces,
} from "../db/schema/index.js";
import { createSignedDownloadUrl, type SignedUrlResult } from "./cloudStorageService.js";
import {
  flattenMatrix3x3,
  flattenPointPairs,
  unflattenMatrix3x3,
  unflattenPointPairs,
  type ArUcoMarkerRecordDoc,
  type ArUcoScanSession,
  type ArUcoSighting,
  type ArucoMarkerSightingDto,
  type ArucoSightingsResponseDto,
  type CameraIntrinsicsResponseDto,
  type ComputeLockResponseDto,
  type GlobalHomographyPlacementDto,
  type GlobalHomographyPlacementRecord,
  type GlobalHomographySetDto,
  type HomographyLockGroupDto,
  type HomographyLockGroupRecord,
  type LocalHomography,
  type LocalHomographyResponseDto,
  type LocalHomographyWorkspaceDto,
  type Matrix3x3,
  type ProjectGlobalHomographySetDoc,
  type PuzzlePieceArtifact,
  type PuzzlePieceDto,
  type PuzzlePieceMetadataDto,
  type PuzzleWorkspaceResponseDto,
  type SaveGlobalHomographiesDto,
  type SaveGlobalHomographiesResponseDto,
  type SessionStatusResponseDto,
  type SubmitArucoSightingsDto,
  type SubmitLocalHomographyDto,
} from "../models/homography.js";

const PUZZLE_PIECE_GENERATION_VERSION = 2;

/** Ported from HomographyController's ArgumentException -> BadRequest(400) mappings. */
export class HomographyValidationError extends Error {}
/** Ported from HomographyController's KeyNotFoundException -> NotFound(404) mappings. */
export class HomographyNotFoundError extends Error {}
/** Ported from HomographyController's InvalidOperationException -> UnprocessableEntity(422) mapping on /compute-lock. */
export class HomographyLockError extends Error {}

// ---------------------------------------------------------------------------
// Row -> doc mapping (DB columns -> the PascalCase doc shapes the logic below uses)
// ---------------------------------------------------------------------------

type LocalRow = typeof localHomographies.$inferSelect;
type SessionRow = typeof arucoSessions.$inferSelect;
type SightingRow = typeof arucoSightings.$inferSelect;
type PuzzleRow = typeof puzzlePieces.$inferSelect;
type GlobalRow = typeof globalHomographies.$inferSelect;

function toLocalHomography(r: LocalRow): LocalHomography {
  return {
    Id: r.id,
    DeviceId: r.deviceId,
    CameraMac: r.cameraMac,
    MatrixFlat: r.matrixFlat,
    FrameSize: r.frameSize,
    Inliers: r.inliers as number,
    RmseBoard: r.rmseBoard as number,
    CornersUsed: r.cornersUsed as number,
    MarkersDetected: r.markersDetected as number,
    ArucoDict: r.arucoDict,
    SquaresX: r.squaresX as number,
    SquaresY: r.squaresY as number,
    SquareLength: r.squareLength as number,
    MarkerLength: r.markerLength as number,
    TimestampUnix: r.timestampUnix as number,
    SnapshotPath: r.snapshotPath,
    CameraMatrixFlat: r.cameraMatrixFlat,
    DistortionCoefficients: r.distortionCoefficients,
    UsedUndistortedImage: r.usedUndistortedImage,
  };
}

function toArUcoSession(r: SessionRow): ArUcoScanSession {
  return {
    Id: r.id,
    ArucoDict: r.arucoDict,
    Status: r.status,
    CamerasCheckedIn: r.camerasCheckedIn,
    CamerasTotal: r.camerasTotal,
    CreatedAt: r.createdAt,
  };
}

function toArUcoSighting(r: SightingRow): ArUcoSighting {
  return {
    Id: r.id,
    SessionId: r.sessionId,
    DeviceId: r.deviceId,
    CameraMac: r.cameraMac,
    ArucoDict: r.arucoDict,
    CapturedAt: r.capturedAt,
    Markers: r.markers,
    LocalHomographyHash: r.localHomographyHash,
  };
}

function toPuzzlePieceArtifact(r: PuzzleRow): PuzzlePieceArtifact {
  return {
    Id: r.id,
    ProjectId: r.projectId,
    DeviceId: r.deviceId,
    CameraMac: r.cameraMac,
    LocalHomographyId: r.localHomographyId,
    LocalHomographyHash: r.localHomographyHash,
    LocalHomographyMatrixFlat: r.localHomographyMatrixFlat,
    HLocalCanvasFlat: r.hLocalCanvasFlat,
    SourceFrameSize: r.sourceFrameSize,
    PuzzlePieceSize: r.puzzlePieceSize,
    SourceSnapshotPath: r.sourceSnapshotPath,
    UsedUndistortedImage: r.usedUndistortedImage,
    UndistortMode: r.undistortMode,
    BboxTrimPct: r.bboxTrimPct,
    HomographyFile: r.homographyFile,
    PuzzlePiecePath: r.puzzlePiecePath,
    MetadataPath: r.metadataPath,
    GenerationVersion: r.generationVersion,
    GeneratedAt: r.generatedAt,
  };
}

function toGlobalSetDoc(r: GlobalRow): ProjectGlobalHomographySetDoc {
  return {
    ProjectId: r.projectId,
    FloorplanId: r.floorplanId,
    MmPerFpPx: r.mmPerFpPx,
    OriginFp: r.originFp,
    FloorplanSize: r.floorplanSize,
    Placements: r.placements as GlobalHomographyPlacementRecord[] | null,
    LockedGroups: r.lockedGroups as HomographyLockGroupRecord[] | null,
    SavedByUserId: r.savedByUserId,
    SavedAt: r.savedAt,
  };
}

function normalizeMac(mac?: string | null): string {
  return (mac ?? "").trim().toLowerCase();
}

function distinctCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(v);
    }
  }
  return result;
}

// ===========================================================================
// Pure 3x3 matrix / homography math - ported EXACTLY from HomographyService.cs's
// private static helpers. Each function cites the C# method it mirrors.
// ===========================================================================

/** Mirrors HomographyService.Identity3x3. */
function identity3x3(): Matrix3x3 {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

/** Mirrors HomographyService.MatMul3x3 - standard 3x3 matrix product C = A * B (loop order i,j,k preserved). */
function matMul3x3(a: Matrix3x3, b: Matrix3x3): Matrix3x3 {
  const c: Matrix3x3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[i][k] * b[k][j];
      c[i][j] = sum;
    }
  }
  return c;
}

/** Mirrors HomographyService.ApplyHomographyPoint. Degenerate (near-zero denominator) points map to [0, 0], matching the C# fallback. */
function applyHomographyPoint(h: Matrix3x3, x: number, y: number): [number, number] {
  const denom = h[2][0] * x + h[2][1] * y + h[2][2];
  if (Math.abs(denom) < 1e-12) return [0, 0];
  return [(h[0][0] * x + h[0][1] * y + h[0][2]) / denom, (h[1][0] * x + h[1][1] * y + h[1][2]) / denom];
}

/**
 * Mirrors HomographyService.EstimateSimilarity2D - closed-form least-squares fit of a 2D
 * similarity transform (uniform scale `a`,`b` encode scale*cos/scale*sin, plus translation
 * tx,ty) mapping source points to destination points, via centroid-relative covariance sums.
 * This is the standard 2-parameter (complex-number) linear least-squares solution for
 * similarity transforms - not a full Umeyama SVD solve, and it does not model reflections,
 * exactly as written in the C# source.
 */
function estimateSimilarity2D(pairs: Array<[number, number, number, number]>): Matrix3x3 {
  if (pairs.length < 2) {
    throw new HomographyLockError("Need at least 2 point pairs for similarity estimation.");
  }

  const n = pairs.length;
  let srcMx = 0;
  let srcMy = 0;
  let dstMx = 0;
  let dstMy = 0;
  for (const [sx, sy, dx, dy] of pairs) {
    srcMx += sx;
    srcMy += sy;
    dstMx += dx;
    dstMy += dy;
  }
  srcMx /= n;
  srcMy /= n;
  dstMx /= n;
  dstMy /= n;

  let sumA = 0;
  let sumB = 0;
  let sumSq = 0;
  for (const [sx, sy, dx, dy] of pairs) {
    const scx = sx - srcMx;
    const scy = sy - srcMy;
    const dcx = dx - dstMx;
    const dcy = dy - dstMy;
    sumA += scx * dcx + scy * dcy;
    sumB += scx * dcy - scy * dcx;
    sumSq += scx * scx + scy * scy;
  }

  let a: number;
  let b: number;
  if (sumSq < 1e-12) {
    a = 1;
    b = 0;
  } else {
    a = sumA / sumSq;
    b = sumB / sumSq;
  }

  const tx = dstMx - (a * srcMx - b * srcMy);
  const ty = dstMy - (b * srcMx + a * srcMy);

  return [
    [a, -b, tx],
    [b, a, ty],
    [0, 0, 1],
  ];
}

/**
 * Best-effort port of C#'s `Math.Round(v, 4)` (which defaults to MidpointRounding.ToEven,
 * i.e. banker's rounding) followed by `ToString("F4", InvariantCulture)`. JS has no builtin
 * banker's rounding, and exact-.5 decimal boundaries are rare after binary floating point
 * multiplication by 10000, so this is unlikely to diverge in practice for real calibration
 * data - but it is NOT guaranteed bit-for-bit identical to .NET for values that land exactly
 * on a rounding boundary. Flagged in the migration write-up as the one place in this file
 * that isn't a certain exact match.
 */
function formatFixed4BankersRounding(v: number): string {
  const factor = 10000;
  const scaled = v * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded: number;
  if (diff < 0.5) rounded = floor;
  else if (diff > 0.5) rounded = floor + 1;
  else rounded = floor % 2 === 0 ? floor : floor + 1; // exact .5 -> round to even
  const result = rounded / factor;
  return (Object.is(result, -0) ? 0 : result).toFixed(4);
}

/**
 * Mirrors HomographyService.ComputeHomographyHash: flatten row-major, round each value to 4
 * decimal places, join with commas, SHA-256 the UTF-8 bytes, take the first 16 hex chars
 * lowercased. Used purely for staleness detection (comparing a sighting's recorded hash
 * against a camera's current local homography), so hex-case ordering is irrelevant - Node's
 * crypto digest("hex") already produces lowercase.
 */
function computeHomographyHash(matrix: Matrix3x3): string {
  const values = matrix.flatMap((row) => row).map((v) => formatFixed4BankersRounding(v));
  const input = values.join(",");
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").slice(0, 16);
}

/** Mirrors HomographyService.BuildPlacementTransform. */
function buildPlacementTransform(
  centerFp: number[],
  angleDeg: number,
  scale: number,
  localCanvasSize: number[],
): Matrix3x3 {
  if (localCanvasSize.length < 2 || localCanvasSize[0] <= 0 || localCanvasSize[1] <= 0) {
    throw new HomographyValidationError("LocalCanvasSize must contain positive width and height.");
  }
  const pivotX = localCanvasSize[0] / 2;
  const pivotY = localCanvasSize[1] / 2;
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle) * scale;
  const sin = Math.sin(angle) * scale;
  const centerX = centerFp[0];
  const centerY = centerFp[1];

  return [
    [cos, -sin, centerX - cos * pivotX + sin * pivotY],
    [sin, cos, centerY - sin * pivotX - cos * pivotY],
    [0, 0, 1],
  ];
}

/** Mirrors HomographyService.BuildFloorplanPixelToMmTransform. Note the deliberate Y-axis flip (-mmPerFpPx). */
function buildFloorplanPixelToMmTransform(mmPerFpPx: number, originFp: number[]): Matrix3x3 {
  return [
    [mmPerFpPx, 0, -originFp[0] * mmPerFpPx],
    [0, -mmPerFpPx, originFp[1] * mmPerFpPx],
    [0, 0, 1],
  ];
}

// ===========================================================================
// Validation helpers - mirrors HomographyService's private static Validate*/Normalize* helpers.
// ===========================================================================

function normalizePoint(point: number[] | null | undefined, name: string): number[] {
  if (!point || point.length < 2) throw new HomographyValidationError(`${name} must contain two numeric values.`);
  return [point[0], point[1]];
}

function normalizeIntPair(values: number[] | null | undefined, name: string): number[] {
  if (!values || values.length < 2 || values[0] <= 0 || values[1] <= 0) {
    throw new HomographyValidationError(`${name} must contain positive width and height values.`);
  }
  return [values[0], values[1]];
}

function validateRequiredString(value: string | null | undefined, name: string): void {
  if (!value?.trim()) throw new HomographyValidationError(`${name} is required.`);
}

function validateMatrix3x3(matrix: Matrix3x3 | null | undefined, name: string): void {
  if (!matrix || matrix.length !== 3 || matrix.some((row) => !row || row.length !== 3)) {
    throw new HomographyValidationError(`${name} must be a 3x3 matrix.`);
  }
}

function cleanNullable(value?: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function buildPuzzlePieceDocumentId(projectId: string, deviceId: string, cameraMac: string): string {
  return `${projectId}__${deviceId}__${normalizeMac(cameraMac).replace(/:/g, "_")}`;
}

/** Mirrors HomographyService.BuildCameraKey. Lowercased as a whole because artifactsByKey in the
 * C# source is a case-insensitive dictionary (StringComparer.OrdinalIgnoreCase); it is used purely
 * as an internal lookup key, never surfaced to callers. */
function buildCameraKey(deviceId: string, cameraMac: string): string {
  return `${deviceId}::${normalizeMac(cameraMac)}`.toLowerCase();
}

// ===========================================================================
// submit-local / intrinsics / submit-sightings / session-status / has-local / snapshot-url
// ===========================================================================

/** Mirrors HomographyService.SubmitLocalHomography - upsert, one doc per (deviceId, cameraMac). */
export async function submitLocalHomography(
  deviceId: string,
  dto: SubmitLocalHomographyDto,
): Promise<LocalHomographyResponseDto> {
  const mac = normalizeMac(dto.CameraMac);
  const docId = `${deviceId}_${mac}`;

  const values = {
    deviceId,
    cameraMac: mac,
    matrixFlat: flattenMatrix3x3(dto.Matrix),
    frameSize: dto.FrameSize ?? null,
    inliers: dto.Inliers ?? null,
    rmseBoard: dto.RmseBoard ?? null,
    cornersUsed: dto.CornersUsed ?? null,
    markersDetected: dto.MarkersDetected ?? null,
    arucoDict: dto.ArucoDict ?? null,
    squaresX: dto.SquaresX ?? null,
    squaresY: dto.SquaresY ?? null,
    squareLength: dto.SquareLength ?? null,
    markerLength: dto.MarkerLength ?? null,
    timestampUnix: dto.TimestampUnix ?? null,
    snapshotPath: dto.SnapshotPath ?? null,
    cameraMatrixFlat: flattenMatrix3x3(dto.CameraMatrix ?? null),
    distortionCoefficients: dto.DistortionCoefficients ?? null,
    usedUndistortedImage: dto.UsedUndistortedImage ?? null,
  };

  await getDb()
    .insert(localHomographies)
    .values({ id: docId, ...values })
    .onConflictDoUpdate({ target: localHomographies.id, set: values });
  return { HomographyId: docId, CameraMac: dto.CameraMac };
}

/** Mirrors HomographyService.GetIntrinsics. */
export async function getIntrinsics(deviceId: string, mac: string): Promise<CameraIntrinsicsResponseDto | null> {
  const docId = `${deviceId}_${normalizeMac(mac)}`;
  const [row] = await getDb().select().from(localHomographies).where(eq(localHomographies.id, docId)).limit(1);
  if (!row) return null;

  const record = toLocalHomography(row);
  const cameraMatrix = unflattenMatrix3x3(record.CameraMatrixFlat);
  if (!cameraMatrix || !record.DistortionCoefficients) return null;

  return {
    CameraMac: record.CameraMac ?? mac,
    CameraMatrix: cameraMatrix,
    DistortionCoefficients: record.DistortionCoefficients,
    TimestampUnix: record.TimestampUnix,
  };
}

/**
 * Mirrors HomographyService.ResolveOrCreateSession: resolves an existing session by id (2nd-Nth
 * camera of a scan run), or always creates a fresh one when sessionId is absent (1st camera) -
 * deliberately never auto-joins an existing session in that case, matching the C# comment
 * ("markers may have moved since the last scan").
 */
async function resolveOrCreateSession(
  sessionId: string | null | undefined,
  arucoDict: string,
): Promise<ArUcoScanSession> {
  const db = getDb();
  if (sessionId?.trim()) {
    const [existing] = await db.select().from(arucoSessions).where(eq(arucoSessions.id, sessionId)).limit(1);
    if (existing) return toArUcoSession(existing);
  }

  const [created] = await db
    .insert(arucoSessions)
    .values({ arucoDict, status: "collecting", camerasCheckedIn: [], camerasTotal: 0, createdAt: new Date() })
    .returning();
  return toArUcoSession(created);
}

/** Mirrors HomographyService.SubmitArucoSightings. */
export async function submitArucoSightings(
  deviceId: string,
  dto: SubmitArucoSightingsDto,
): Promise<ArucoSightingsResponseDto> {
  const mac = normalizeMac(dto.CameraMac);
  const db = getDb();

  const session = await resolveOrCreateSession(dto.SessionId, dto.ArucoDict);
  const sessionId = session.Id;

  const markers: ArUcoMarkerRecordDoc[] = (dto.Markers ?? []).map((m: ArucoMarkerSightingDto) => ({
    MarkerId: m.MarkerId,
    CornersPxFlat: flattenPointPairs(m.CornersPx),
  }));

  const sightingValues = {
    sessionId,
    deviceId,
    cameraMac: mac,
    arucoDict: dto.ArucoDict ?? null,
    capturedAt: dto.CapturedAt ?? null,
    markers,
    localHomographyHash: dto.LocalHomographyHash ?? null,
  };

  await db
    .insert(arucoSightings)
    .values({ id: `${sessionId}_${mac}`, ...sightingValues })
    .onConflictDoUpdate({ target: arucoSightings.id, set: sightingValues });

  let checkedIn = session.CamerasCheckedIn ?? [];
  if (!checkedIn.some((c) => c.toLowerCase() === mac)) {
    checkedIn = [...checkedIn, mac];
    await db
      .update(arucoSessions)
      .set({ camerasCheckedIn: checkedIn, camerasTotal: checkedIn.length })
      .where(eq(arucoSessions.id, sessionId));
    session.CamerasCheckedIn = checkedIn;
    session.CamerasTotal = checkedIn.length;
  }

  return {
    SessionId: sessionId,
    Status: session.Status,
    CamerasCheckedIn: session.CamerasCheckedIn ?? [],
    CamerasTotal: session.CamerasTotal,
  };
}

/** Mirrors HomographyService.GetSessionStatus. */
export async function getSessionStatus(sessionId: string): Promise<SessionStatusResponseDto> {
  const [row] = await getDb().select().from(arucoSessions).where(eq(arucoSessions.id, sessionId)).limit(1);
  if (!row) throw new HomographyNotFoundError(`Session ${sessionId} not found.`);

  const session = toArUcoSession(row);
  return {
    SessionId: sessionId,
    Status: session.Status,
    CamerasCheckedIn: session.CamerasCheckedIn ?? [],
    CamerasTotal: session.CamerasTotal,
    CreatedAt: session.CreatedAt.toISOString(),
  };
}

/** Mirrors HomographyService.HasLocalHomography. */
export async function hasLocalHomography(deviceId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: localHomographies.id })
    .from(localHomographies)
    .where(eq(localHomographies.deviceId, deviceId))
    .limit(1);
  return rows.length > 0;
}

/** Mirrors HomographyService.GetSnapshotUrlAsync. */
export async function getSnapshotUrl(deviceId: string, cameraMac: string): Promise<string | null> {
  const docId = `${deviceId}_${normalizeMac(cameraMac)}`;
  const [row] = await getDb().select().from(localHomographies).where(eq(localHomographies.id, docId)).limit(1);
  if (!row) return null;

  const record = toLocalHomography(row);
  if (!record.SnapshotPath?.trim()) return null;

  const result = await createSignedDownloadUrl({ PathFromRoot: record.SnapshotPath });
  return result.SignedUrl;
}

// ===========================================================================
// compute-lock - the BFS multi-camera similarity-transform lock. This is the
// core "real geometry" computation in this resource; every step below mirrors
// HomographyService.RunBfsLock / StoreLocked / WriteArucoLockStatus exactly,
// including iteration order (Maps preserve insertion order like C#
// Dictionary enumeration does in practice).
// ===========================================================================

async function writeArucoLockStatus(cameraDevice: Map<string, string>, status: string): Promise<void> {
  const deviceIds = distinctCaseInsensitive(Array.from(cameraDevice.values()));
  // DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0
  const nowUnixSeconds = Date.now() / 1000;
  const db = getDb();

  for (const deviceId of deviceIds) {
    try {
      // Equivalent of C#'s UpdateAsync("Config.ArucoLock.Status", ...) nested-field write: merge into the
      // device's Config jsonb, creating Config/ArucoLock when absent. Row-locked so concurrent writers serialize.
      await db.transaction(async (tx) => {
        const [row] = await tx.select().from(devices).where(eq(devices.id, deviceId)).for("update").limit(1);
        if (!row) throw new Error(`Device ${deviceId} not found.`);
        const config = (row.config ?? {}) as Record<string, unknown>;
        const aruco = (config.ArucoLock ?? {}) as Record<string, unknown>;
        await tx
          .update(devices)
          .set({ config: { ...config, ArucoLock: { ...aruco, Status: status, LastRunUnix: nowUnixSeconds } } })
          .where(eq(devices.id, deviceId));
      });
    } catch {
      // Mirrors the C# catch-and-log-warning: a failed status write must not fail compute-lock itself.
    }
  }
}

async function storeLocked(
  mac: string,
  cameraDevice: Map<string, string>,
  tToGlobal: Matrix3x3,
  localHomographyCache: Map<string, LocalHomography | null>,
): Promise<number> {
  const deviceId = cameraDevice.get(mac);
  if (!deviceId) return 0;

  const localH = localHomographyCache.get(mac);
  if (!localH) return 0;

  const matrix = unflattenMatrix3x3(localH.MatrixFlat);
  if (!matrix) return 0;

  const hLocked = matMul3x3(tToGlobal, matrix);
  const values = { deviceId, cameraMac: mac, matrixFlat: flattenMatrix3x3(hLocked), computedAt: new Date() };
  await getDb()
    .insert(lockedHomographies)
    .values({ id: `${deviceId}_${mac}`, ...values })
    .onConflictDoUpdate({ target: lockedHomographies.id, set: values });
  return 1;
}

async function runBfsLock(): Promise<{ count: number; cameraDevice: Map<string, string> }> {
  const db = getDb();
  const sightingRows = await db.select().from(arucoSightings);

  // cameraMarkersPx.get(mac).get(`${sessionId}_${markerId}`) = raw pixel corners [[x,y]x4].
  const cameraMarkersPx = new Map<string, Map<string, number[][]>>();
  const cameraDevice = new Map<string, string>();

  // First pass: collect device IDs and the most recent sighting per camera (last write wins,
  // matching the Firestore upsert semantics used by submitArucoSightings).
  const sightingsByCam = new Map<string, ArUcoSighting>();
  for (const row of sightingRows) {
    const data = toArUcoSighting(row);
    const mac = data.CameraMac;
    if (!mac || !data.SessionId) continue;
    if (data.DeviceId) cameraDevice.set(mac, data.DeviceId);
    sightingsByCam.set(mac, data);
  }

  // Load current local homographies once per camera and compute their hashes.
  const localHomographyCache = new Map<string, LocalHomography | null>();
  for (const mac of sightingsByCam.keys()) {
    const deviceId = cameraDevice.get(mac);
    if (!deviceId) continue;
    const [localRow] = await db
      .select()
      .from(localHomographies)
      .where(eq(localHomographies.id, `${deviceId}_${mac}`))
      .limit(1);
    localHomographyCache.set(mac, localRow ? toLocalHomography(localRow) : null);
  }

  // Filter: discard sightings whose attached homography hash doesn't match the camera's
  // current local homography - protects compute-lock from stale sightings captured before
  // the camera was moved and re-calibrated.
  for (const [mac, s] of sightingsByCam) {
    const lh = localHomographyCache.get(mac);
    const currentMatrix = lh?.MatrixFlat ? unflattenMatrix3x3(lh.MatrixFlat) : null;
    const currentHash = currentMatrix ? computeHomographyHash(currentMatrix) : null;

    if (!s.LocalHomographyHash || !currentHash) continue;
    if (s.LocalHomographyHash.toLowerCase() !== currentHash.toLowerCase()) continue;

    if (!cameraMarkersPx.has(mac)) cameraMarkersPx.set(mac, new Map());
    const markerMap = cameraMarkersPx.get(mac)!;
    for (const m of s.Markers ?? []) {
      const key = `${s.SessionId}_${m.MarkerId}`;
      markerMap.set(key, unflattenPointPairs(m.CornersPxFlat) ?? []);
    }
  }

  if (cameraMarkersPx.size === 0) {
    throw new HomographyLockError("No sightings found with a valid homography hash. Run a fresh ArUco scan.");
  }

  // Apply each camera's local homography server-side to convert pixel corners to local world
  // coords (the devices only ever store raw pixel observations).
  const cameraMarkersLocal = new Map<string, Map<string, number[][]>>();
  for (const [mac, markerPxMap] of cameraMarkersPx) {
    const localH = localHomographyCache.get(mac);
    const matrix = localH ? unflattenMatrix3x3(localH.MatrixFlat) : null;
    if (!matrix) continue;
    const localMap = new Map<string, number[][]>();
    for (const [key, pxCorners] of markerPxMap) {
      const localCorners = pxCorners.filter((c) => c.length >= 2).map((c) => applyHomographyPoint(matrix, c[0], c[1]));
      localMap.set(
        key,
        localCorners.map(([x, y]) => [x, y]),
      );
    }
    cameraMarkersLocal.set(mac, localMap);
  }

  const cameras = Array.from(cameraMarkersLocal.keys());
  if (cameras.length === 0) {
    throw new HomographyLockError("No cameras have both sightings and a valid local homography.");
  }

  if (cameras.length === 1) {
    const count = await storeLocked(cameras[0], cameraDevice, identity3x3(), localHomographyCache);
    return { count, cameraDevice };
  }

  // Build similarity transform edges between all camera pairs that share markers.
  // edges key: "from|to" -> transform mapping `from`-local coords to `to`-local coords.
  const edges = new Map<string, Matrix3x3>();
  for (let i = 0; i < cameras.length; i++) {
    for (let j = i + 1; j < cameras.length; j++) {
      const ci = cameras[i];
      const cj = cameras[j];
      const mapI = cameraMarkersLocal.get(ci)!;
      const mapJ = cameraMarkersLocal.get(cj)!;
      const sharedKeys = Array.from(mapI.keys()).filter((k) => mapJ.has(k));
      if (sharedKeys.length === 0) continue;

      const pairsIJ: Array<[number, number, number, number]> = [];
      const pairsJI: Array<[number, number, number, number]> = [];
      for (const key of sharedKeys) {
        const cornersI = mapI.get(key)!;
        const cornersJ = mapJ.get(key)!;
        const n = Math.min(cornersI.length, cornersJ.length);
        for (let k = 0; k < n; k++) {
          if (cornersI[k].length < 2 || cornersJ[k].length < 2) continue;
          pairsIJ.push([cornersI[k][0], cornersI[k][1], cornersJ[k][0], cornersJ[k][1]]);
          pairsJI.push([cornersJ[k][0], cornersJ[k][1], cornersI[k][0], cornersI[k][1]]);
        }
      }
      if (pairsIJ.length < 2) continue;
      edges.set(`${ci}|${cj}`, estimateSimilarity2D(pairsIJ));
      edges.set(`${cj}|${ci}`, estimateSimilarity2D(pairsJI));
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const key of edges.keys()) {
    const [a, b] = key.split("|");
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    if (!adjacency.get(a)!.includes(b)) adjacency.get(a)!.push(b);
    if (!adjacency.get(b)!.includes(a)) adjacency.get(b)!.push(a);
  }

  // Root: highest-degree camera, ties broken alphabetically (Array.prototype.sort is a
  // stable sort in Node, matching LINQ's stable OrderByDescending().ThenBy()).
  const root = cameras
    .slice()
    .sort((a, b) => {
      const countA = adjacency.get(a)?.length ?? 0;
      const countB = adjacency.get(b)?.length ?? 0;
      if (countB !== countA) return countB - countA;
      return a < b ? -1 : a > b ? 1 : 0;
    })[0];

  const tToGlobal = new Map<string, Matrix3x3>();
  tToGlobal.set(root, identity3x3());
  const queue: string[] = [root];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    const neighbors = adjacency.get(parent) ?? [];
    for (const child of neighbors) {
      if (tToGlobal.has(child)) continue;
      const t = edges.get(`${child}|${parent}`);
      if (!t) continue;
      tToGlobal.set(child, matMul3x3(tToGlobal.get(parent)!, t));
      queue.push(child);
    }
  }
  // Cameras left out of tToGlobal here are unreachable from root and are silently skipped,
  // same as the C# source (which only logs a warning for them).

  let count = 0;
  for (const [mac, t] of tToGlobal) {
    count += await storeLocked(mac, cameraDevice, t, localHomographyCache);
  }
  return { count, cameraDevice };
}

/** Mirrors HomographyService.ComputeLock. */
export async function computeLock(): Promise<ComputeLockResponseDto> {
  let cameraDevice = new Map<string, string>();
  try {
    const result = await runBfsLock();
    cameraDevice = result.cameraDevice;
    await writeArucoLockStatus(cameraDevice, "locked");
    return { Status: "locked", CamerasComputed: result.count };
  } catch (err) {
    await writeArucoLockStatus(cameraDevice, "failed");
    throw err;
  }
}

// ===========================================================================
// global-homographies (project floorplan placement composition) - pure matrix
// math, no image processing. Mirrors HomographyService.SaveGlobalHomographies.
// ===========================================================================

function toGlobalHomographySetDto(record: ProjectGlobalHomographySetDoc): GlobalHomographySetDto {
  const placements: GlobalHomographyPlacementDto[] = (record.Placements ?? []).map((p) => ({
    PuzzlePieceId: p.PuzzlePieceId ?? "",
    DeviceId: p.DeviceId ?? "",
    CameraMac: normalizeMac(p.CameraMac),
    CenterFp: p.CenterFp ?? [],
    AngleDeg: p.AngleDeg,
    Scale: p.Scale,
    HLocalCanvas: unflattenMatrix3x3(p.HLocalCanvasFlat) ?? [],
    LocalCanvasSize: p.LocalCanvasSize ?? [],
    GlobalHomographyFloorplan: unflattenMatrix3x3(p.GlobalHomographyFloorplanFlat) ?? [],
    GlobalHomography: unflattenMatrix3x3(p.GlobalHomographyFlat) ?? [],
  }));

  const lockedGroups: HomographyLockGroupDto[] = (record.LockedGroups ?? []).map((g) => ({
    GroupId: g.GroupId ?? "",
    CameraMacs: (g.CameraMacs ?? []).filter((mac) => mac?.trim()).map(normalizeMac),
  }));

  return {
    ProjectId: record.ProjectId ?? "",
    FloorplanId: record.FloorplanId ?? null,
    MmPerFpPx: record.MmPerFpPx,
    OriginFp: record.OriginFp ?? [],
    FloorplanSize: record.FloorplanSize ?? [],
    Placements: placements,
    LockedGroups: lockedGroups,
    SavedAt: record.SavedAt.toISOString(),
    SavedByUserId: record.SavedByUserId ?? null,
  };
}

/** Mirrors HomographyService.SaveGlobalHomographies. */
export async function saveGlobalHomographies(
  projectId: string,
  savedByUserId: string,
  dto: SaveGlobalHomographiesDto,
): Promise<SaveGlobalHomographiesResponseDto> {
  if (!projectId?.trim()) throw new HomographyValidationError("projectId is required.");
  if (!savedByUserId?.trim()) throw new HomographyValidationError("savedByUserId is required.");
  if (!dto) throw new HomographyValidationError("Invalid payload.");
  if (!(dto.MmPerFpPx > 0)) throw new HomographyValidationError("MmPerFpPx must be greater than 0.");

  const originFp = normalizePoint(dto.OriginFp, "OriginFp");
  const floorplanSize = normalizeIntPair(dto.FloorplanSize, "FloorplanSize");
  if (!dto.Placements || dto.Placements.length === 0) {
    throw new HomographyValidationError("At least one placement is required.");
  }

  const placements: GlobalHomographyPlacementRecord[] = dto.Placements.map((placement) => {
    validateRequiredString(placement.PuzzlePieceId, "PuzzlePieceId");
    validateRequiredString(placement.DeviceId, "DeviceId");
    const cameraMac = normalizeMac(placement.CameraMac);
    validateMatrix3x3(placement.HLocalCanvas, "HLocalCanvas");
    const centerFp = normalizePoint(placement.CenterFp, "CenterFp");
    const localCanvasSize = normalizeIntPair(placement.LocalCanvasSize, "LocalCanvasSize");

    // Composition order matches the C# source exactly:
    //   globalFloorplan = floorplanTransform * hLocalCanvas       (camera-local px -> floorplan px)
    //   globalMm        = floorplanToMm     * globalFloorplan     (camera-local px -> floorplan mm)
    const floorplanTransform = buildPlacementTransform(centerFp, placement.AngleDeg, placement.Scale, localCanvasSize);
    const hLocalCanvas = placement.HLocalCanvas;
    const globalFloorplan = matMul3x3(floorplanTransform, hLocalCanvas);
    const floorplanToMm = buildFloorplanPixelToMmTransform(dto.MmPerFpPx, originFp);
    const globalMm = matMul3x3(floorplanToMm, globalFloorplan);

    return {
      PuzzlePieceId: placement.PuzzlePieceId.trim(),
      DeviceId: placement.DeviceId.trim(),
      CameraMac: cameraMac,
      CenterFp: centerFp,
      AngleDeg: placement.AngleDeg,
      Scale: placement.Scale,
      HLocalCanvasFlat: flattenMatrix3x3(placement.HLocalCanvas),
      LocalCanvasSize: localCanvasSize,
      GlobalHomographyFloorplanFlat: flattenMatrix3x3(globalFloorplan),
      GlobalHomographyFlat: flattenMatrix3x3(globalMm),
    };
  });

  const lockedGroups: HomographyLockGroupRecord[] = (dto.LockedGroups ?? [])
    .filter((g) => g.GroupId?.trim())
    .map((g) => ({
      GroupId: g.GroupId.trim(),
      CameraMacs: distinctCaseInsensitive((g.CameraMacs ?? []).filter((mac) => mac?.trim()).map(normalizeMac)),
    }))
    .filter((g) => g.CameraMacs.length > 0);

  const record: ProjectGlobalHomographySetDoc = {
    ProjectId: projectId,
    FloorplanId: cleanNullable(dto.FloorplanId),
    MmPerFpPx: dto.MmPerFpPx,
    OriginFp: originFp,
    FloorplanSize: floorplanSize,
    Placements: placements,
    LockedGroups: lockedGroups,
    SavedByUserId: savedByUserId,
    SavedAt: new Date(),
  };

  const globalValues = {
    floorplanId: record.FloorplanId ?? null,
    mmPerFpPx: record.MmPerFpPx,
    originFp: record.OriginFp ?? null,
    floorplanSize: record.FloorplanSize ?? null,
    placements: record.Placements ?? null,
    lockedGroups: record.LockedGroups ?? null,
    savedByUserId: record.SavedByUserId ?? null,
    savedAt: record.SavedAt,
  };
  await getDb()
    .insert(globalHomographies)
    .values({ projectId, ...globalValues })
    .onConflictDoUpdate({ target: globalHomographies.projectId, set: globalValues });

  const responseDto = toGlobalHomographySetDto(record);
  return {
    ProjectId: projectId,
    PlacementsSaved: placements.length,
    SavedAt: responseDto.SavedAt,
    GlobalHomographies: responseDto,
  };
}

// ===========================================================================
// Puzzle workspace (GetPuzzleWorkspace / RefreshPuzzlePieces / GetPuzzlePiece).
//
// NOT PORTED: HomographyService.GeneratePuzzlePieceAsync (and its helpers
// UndistortImageOptimal, ComputeWarpedBbox, WarpBgra, TrimTransparentBorder,
// EnsureBgra/EnsureBgr, ToCvMat/ToCvDistortion) is NOT ported here. That method
// downloads the raw snapshot image, undistorts it via OpenCV's
// getOptimalNewCameraMatrix + initUndistortRectifyMap + remap, computes a
// bird's-eye-view bounding box, warps the image with warpPerspective, and
// re-encodes/uploads a PNG. This needs a real image-decode/warp/undistort
// library equivalent to OpenCV (OpenCvSharp in the C# source) - there is no
// pure-JS/TS equivalent of lens undistortion + perspective warp worth hand
// rolling (this is exactly the kind of "looks plausible but is subtly wrong"
// risk flagged in the task brief). See the migration report for the two
// options: a native binding (e.g. `opencv4nodejs`) or a WASM build (e.g.
// `@techstark/opencv-js`) - neither has been added to package.json here.
//
// What IS ported below is everything else in the workspace flow: listing
// local homographies, reading/validating cached puzzle-piece artifacts
// (including the exact "is this artifact still usable" hash+version check),
// building download URLs for artifacts that already exist, and composing the
// response DTOs. When an artifact would need to be (re)generated, this
// returns a "generation_unsupported" status with a descriptive Error message
// instead of a generated image - a deliberate, clearly-flagged deviation from
// the C# behavior for that one sub-case only.
// ===========================================================================

function isUsablePuzzlePieceArtifact(artifact: PuzzlePieceArtifact, localHash: string): boolean {
  return (
    (artifact.LocalHomographyHash ?? "").toLowerCase() === localHash.toLowerCase() &&
    artifact.GenerationVersion >= PUZZLE_PIECE_GENERATION_VERSION &&
    !!artifact.PuzzlePiecePath?.trim() &&
    !!artifact.MetadataPath?.trim() &&
    !!artifact.HLocalCanvasFlat &&
    artifact.HLocalCanvasFlat.length === 9 &&
    !!artifact.SourceFrameSize &&
    artifact.SourceFrameSize.length >= 2 &&
    !!artifact.PuzzlePieceSize &&
    artifact.PuzzlePieceSize.length >= 2
  );
}

function toLocalWorkspaceDto(local: LocalHomography, localHash: string): LocalHomographyWorkspaceDto {
  return {
    HomographyId: local.Id ?? `${local.DeviceId}_${normalizeMac(local.CameraMac)}`,
    DeviceId: local.DeviceId ?? "",
    CameraMac: normalizeMac(local.CameraMac),
    Matrix: unflattenMatrix3x3(local.MatrixFlat) ?? [],
    FrameSize: local.FrameSize ?? [],
    TimestampUnix: local.TimestampUnix,
    SnapshotPath: local.SnapshotPath ?? null,
    UsedUndistortedImage: local.UsedUndistortedImage ?? null,
    LocalHomographyHash: localHash,
  };
}

function toPuzzlePieceMetadataDto(
  artifact: PuzzlePieceArtifact,
  metadataDownload: SignedUrlResult | null,
): PuzzlePieceMetadataDto {
  const cameraMac = normalizeMac(artifact.CameraMac);
  return {
    PuzzlePieceId: artifact.Id ?? "",
    DeviceId: artifact.DeviceId ?? "",
    CameraMac: cameraMac,
    LocalHomographyId: artifact.LocalHomographyId ?? "",
    LocalHomographyHash: artifact.LocalHomographyHash ?? "",
    HLocalCanvas: unflattenMatrix3x3(artifact.HLocalCanvasFlat) ?? [],
    SourceFrameSize: artifact.SourceFrameSize ?? [],
    PuzzlePieceSize: artifact.PuzzlePieceSize ?? [],
    SourceSnapshotPath: artifact.SourceSnapshotPath ?? null,
    UsedUndistortedImage: artifact.UsedUndistortedImage,
    UndistortMode: artifact.UndistortMode ?? "none",
    BboxTrimPct: artifact.BboxTrimPct,
    HomographyFile: artifact.HomographyFile ?? `${cameraMac.replace(/:/g, "_")}_homography.yml`,
    MetadataPath: artifact.MetadataPath ?? null,
    MetadataDownloadUrl: metadataDownload?.SignedUrl ?? null,
    MetadataDownloadUrlExpiresAt: metadataDownload?.ExpiresAt.toISOString() ?? null,
    GeneratedAt: artifact.GeneratedAt.toISOString(),
  };
}

async function resolvePuzzlePiece(
  projectId: string,
  local: LocalHomography,
  localHash: string,
  artifactsByKey: Map<string, PuzzlePieceArtifact>,
  forceRegeneration: boolean,
): Promise<PuzzlePieceDto> {
  const deviceId = local.DeviceId!;
  const cameraMac = normalizeMac(local.CameraMac);
  const key = buildCameraKey(deviceId, cameraMac);

  const artifact = artifactsByKey.get(key) ?? null;

  if (forceRegeneration || !artifact || !isUsablePuzzlePieceArtifact(artifact, localHash)) {
    if (!local.SnapshotPath?.trim()) {
      return {
        PuzzlePieceId: buildPuzzlePieceDocumentId(projectId, deviceId, cameraMac),
        DeviceId: deviceId,
        CameraMac: cameraMac,
        Status: "missing_snapshot",
        PuzzlePiecePath: null,
        PuzzlePieceDownloadUrl: null,
        PuzzlePieceDownloadUrlExpiresAt: null,
        Metadata: null,
        Error: "No snapshot path is stored for this local homography.",
      };
    }

    // See the "NOT PORTED" block above resolvePuzzlePiece's section header.
    return {
      PuzzlePieceId: buildPuzzlePieceDocumentId(projectId, deviceId, cameraMac),
      DeviceId: deviceId,
      CameraMac: cameraMac,
      Status: "generation_unsupported",
      PuzzlePiecePath: null,
      PuzzlePieceDownloadUrl: null,
      PuzzlePieceDownloadUrlExpiresAt: null,
      Metadata: null,
      Error:
        "Puzzle-piece image generation (lens undistortion + perspective warp via OpenCV) is not yet " +
        "ported to this server - see the NOT PORTED comment in homographyService.ts.",
    };
  }

  let download: SignedUrlResult | null = null;
  if (artifact.PuzzlePiecePath?.trim()) {
    download = await createSignedDownloadUrl({ PathFromRoot: artifact.PuzzlePiecePath });
  }

  let metadataDownload: SignedUrlResult | null = null;
  if (artifact.MetadataPath?.trim()) {
    metadataDownload = await createSignedDownloadUrl({ PathFromRoot: artifact.MetadataPath });
  }

  return {
    PuzzlePieceId: artifact.Id ?? buildPuzzlePieceDocumentId(projectId, deviceId, cameraMac),
    DeviceId: deviceId,
    CameraMac: cameraMac,
    Status: "ready",
    PuzzlePiecePath: artifact.PuzzlePiecePath ?? null,
    PuzzlePieceDownloadUrl: download?.SignedUrl ?? null,
    PuzzlePieceDownloadUrlExpiresAt: download?.ExpiresAt.toISOString() ?? null,
    Metadata: toPuzzlePieceMetadataDto(artifact, metadataDownload),
    Error: null,
  };
}

/** Mirrors HomographyService.GetPuzzleWorkspaceAsync. */
export async function getPuzzleWorkspace(
  projectId: string,
  forcePuzzlePieceRegeneration = false,
): Promise<PuzzleWorkspaceResponseDto> {
  if (!projectId?.trim()) throw new HomographyValidationError("projectId is required.");

  const db = getDb();
  const deviceRows = await db.select({ id: devices.id }).from(devices).where(eq(devices.projectId, projectId));
  const deviceIdSet = new Set(deviceRows.map((d) => d.id.toLowerCase()));

  const artifactRows = await db.select().from(puzzlePieces).where(eq(puzzlePieces.projectId, projectId));
  const artifactsByKey = new Map<string, PuzzlePieceArtifact>();
  for (const row of artifactRows) {
    const data = toPuzzlePieceArtifact(row);
    if (!data.DeviceId?.trim() || !data.CameraMac?.trim()) continue;
    artifactsByKey.set(buildCameraKey(data.DeviceId, data.CameraMac), data);
  }

  const localRows = await db.select().from(localHomographies);
  const localHomographyList = localRows
    .map(toLocalHomography)
    .filter(
      (local) =>
        !!local.DeviceId?.trim() &&
        !!local.CameraMac?.trim() &&
        !!local.MatrixFlat &&
        deviceIdSet.has(local.DeviceId.toLowerCase()),
    )
    .sort((a, b) => {
      const macA = normalizeMac(a.CameraMac);
      const macB = normalizeMac(b.CameraMac);
      return macA < macB ? -1 : macA > macB ? 1 : 0;
    });

  const localDtos: LocalHomographyWorkspaceDto[] = [];
  const pieceDtos: PuzzlePieceDto[] = [];
  const puzzlePieceMetaFiles: PuzzlePieceMetadataDto[] = [];

  for (const local of localHomographyList) {
    const matrix = unflattenMatrix3x3(local.MatrixFlat)!;
    const localHash = computeHomographyHash(matrix);
    localDtos.push(toLocalWorkspaceDto(local, localHash));

    let pieceDto: PuzzlePieceDto;
    try {
      pieceDto = await resolvePuzzlePiece(projectId, local, localHash, artifactsByKey, forcePuzzlePieceRegeneration);
    } catch (err) {
      pieceDto = {
        PuzzlePieceId: buildPuzzlePieceDocumentId(projectId, local.DeviceId!, normalizeMac(local.CameraMac)),
        DeviceId: local.DeviceId!,
        CameraMac: normalizeMac(local.CameraMac),
        Status: "generation_failed",
        PuzzlePiecePath: null,
        PuzzlePieceDownloadUrl: null,
        PuzzlePieceDownloadUrlExpiresAt: null,
        Metadata: null,
        Error: err instanceof Error ? err.message : String(err),
      };
    }

    pieceDtos.push(pieceDto);
    if (pieceDto.Metadata) puzzlePieceMetaFiles.push(pieceDto.Metadata);
  }

  const [globalRow] = await db
    .select()
    .from(globalHomographies)
    .where(eq(globalHomographies.projectId, projectId))
    .limit(1);
  const globalRecord = globalRow ? toGlobalSetDoc(globalRow) : null;
  const globalDto = globalRecord ? toGlobalHomographySetDto(globalRecord) : null;

  return {
    ProjectId: projectId,
    PuzzlePieces: pieceDtos,
    PuzzlePieceMetaFiles: puzzlePieceMetaFiles,
    LocalHomographies: localDtos,
    GlobalHomographies: globalDto,
    LockedGroups: globalDto?.LockedGroups ?? [],
  };
}

/** Mirrors HomographyService.RefreshPuzzlePiecesAsync. */
export async function refreshPuzzlePieces(projectId: string): Promise<PuzzleWorkspaceResponseDto> {
  return getPuzzleWorkspace(projectId, true);
}

/** Mirrors HomographyService.GetPuzzlePieceAsync. */
export async function getPuzzlePiece(
  projectId: string,
  deviceId: string,
  cameraMac: string,
  forceRegeneration: boolean,
): Promise<PuzzlePieceDto> {
  validateRequiredString(projectId, "projectId");
  validateRequiredString(deviceId, "deviceId");
  validateRequiredString(cameraMac, "cameraMac");

  const db = getDb();
  const [deviceRow] = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
  if (!deviceRow) throw new HomographyNotFoundError(`Device '${deviceId}' was not found.`);

  if ((deviceRow.projectId ?? "").toLowerCase() !== projectId.toLowerCase()) {
    throw new HomographyNotFoundError(`Device '${deviceId}' does not belong to project '${projectId}'.`);
  }

  const normalizedMac = normalizeMac(cameraMac);
  const [localRow] = await db
    .select()
    .from(localHomographies)
    .where(eq(localHomographies.id, `${deviceId}_${normalizedMac}`))
    .limit(1);
  if (!localRow) {
    throw new HomographyNotFoundError(`No local homography was found for device '${deviceId}' camera '${normalizedMac}'.`);
  }

  const localData = toLocalHomography(localRow);
  if (!localData.MatrixFlat) {
    throw new HomographyNotFoundError(
      `Local homography for device '${deviceId}' camera '${normalizedMac}' is incomplete.`,
    );
  }

  const local: LocalHomography = {
    ...localData,
    DeviceId: localData.DeviceId ?? deviceId,
    CameraMac: normalizedMac,
  };

  const matrix = unflattenMatrix3x3(local.MatrixFlat)!;
  const localHash = computeHomographyHash(matrix);

  const [artifactRow] = await db
    .select()
    .from(puzzlePieces)
    .where(and(eq(puzzlePieces.id, buildPuzzlePieceDocumentId(projectId, deviceId, normalizedMac))))
    .limit(1);

  const artifactsByKey = new Map<string, PuzzlePieceArtifact>();
  if (artifactRow) {
    const artifactData = toPuzzlePieceArtifact(artifactRow);
    if (artifactData.DeviceId?.trim() && artifactData.CameraMac?.trim()) {
      artifactsByKey.set(buildCameraKey(artifactData.DeviceId, artifactData.CameraMac), artifactData);
    }
  }

  return resolvePuzzlePiece(projectId, local, localHash, artifactsByKey, forceRegeneration);
}

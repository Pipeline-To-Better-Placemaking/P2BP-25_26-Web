import { getWorkstation } from "../workstation/index.js";
import { getDb, type Db } from "../db/client.js";
import { cameraIntrinsics, lockedHomographies } from "../db/schema/index.js";
import { getStorageBucket } from "../config/storage.js";
import { downloadObject, uploadObject } from "./cloudStorageService.js";
import {
  FusionEngineConfig,
  type FusedIdentity,
  type FusionCameraIntrinsics,
  type FusionRequest,
  type FusionResult,
  type HomographyEntry,
  type TrackEvent,
  type TrackObject,
} from "../models/fusion.js";

/**
 * Ported from BetterPlacemaking.SERVER/Services/FusionEngine.cs (1337 lines) - the core fusion
 * algorithm. Despite a comment there claiming an OpenCvSharp4 dependency, the file never calls
 * any OpenCvSharp/Cv2 function (`using OpenCvSharp;` is a dead import) - this is pure hand-rolled
 * math plus Postgres/Supabase Storage I/O, ported 1:1 below, organized into the same ~9 stages as the source:
 *
 *   1. Camera intrinsics loading (dead/unreachable YAML loader) + lens undistortion
 *   2. Postgres homography/intrinsics loaders
 *   3. JSONL track-vector loading
 *   4. Track building
 *   5. World-coordinate transform (undistortion + homography + Kalman smoothing)
 *   6. Core fusion/matching algorithm
 *   7. Track cleaning/smoothing
 *   8. JSON export
 *   9. Async orchestration runner
 *
 * Every constant in FusionEngineConfig (models/fusion.ts) and every threshold/comparison below
 * is preserved exactly as written in the C# source - this governs which camera tracks get fused
 * into the same global identity, so no numeric logic here has been "cleaned up" or reinterpreted.
 */

// ─────────────────────────────────────────────
// MATH HELPERS — ported from VectorMath (FusionEngine.cs)
// ─────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("Vectors must be same length");

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom < 1e-9 ? 0.0 : dot / denom;
}

export function mean(vectors: number[][]): number[] {
  if (vectors.length === 0) throw new Error("Empty vector list");

  const len = vectors[0].length;
  const result = new Array<number>(len).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < len; i++) result[i] += v[i];
  }
  for (let i = 0; i < len; i++) result[i] /= vectors.length;
  return result;
}

export function averageReps(a: number[], b: number[]): number[] {
  const result = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) result[i] = (a[i] + b[i]) / 2;
  return result;
}

/** Ported from VectorMath.Hypot - deliberately the naive sqrt(dx²+dy²), not the native
 * (numerically-different) Math.hypot, to match the source's own formula exactly. */
export function hypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

// ─────────────────────────────────────────────
// KALMAN FILTER 2D — ported from Kalman2D (FusionEngine.cs)
// The C# version preallocates scratch matrices to avoid per-call GC pressure; this port uses
// plain array-of-array matrix helpers instead (same formulas, no allocation-avoidance) since
// correctness, not throughput, is the goal here.
// ─────────────────────────────────────────────

function matMul(A: number[][], B: number[][]): number[][] {
  const rows = A.length;
  const inner = B.length;
  const cols = B[0].length;
  const R: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let s = 0;
      for (let k = 0; k < inner; k++) s += A[i][k] * B[k][j];
      R[i][j] = s;
    }
  }
  return R;
}

function matVec(A: number[][], v: number[]): number[] {
  return A.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
}

function transpose(A: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0].length;
  const R: number[][] = Array.from({ length: cols }, () => new Array<number>(rows).fill(0));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) R[j][i] = A[i][j];
  return R;
}

function addMat(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

function identity(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

/** Ported from Kalman2D.Invert2x2Into - clamps a near-zero determinant to 1e-12, same as the source. */
function invert2x2(M: number[][]): number[][] {
  let det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
  if (Math.abs(det) < 1e-12) det = 1e-12;
  return [
    [M[1][1] / det, -M[0][1] / det],
    [-M[1][0] / det, M[0][0] / det],
  ];
}

/** Ported from Kalman2D (FusionEngine.cs). Constant-velocity 2D Kalman filter: state = [x, y, vx, vy]. */
export class Kalman2D {
  private x: number[] = [0, 0, 0, 0];
  private P: number[][] = [
    [100, 0, 0, 0],
    [0, 100, 0, 0],
    [0, 0, 100, 0],
    [0, 0, 0, 100],
  ];
  private readonly Q: number[][] = [
    [0.01, 0, 0, 0],
    [0, 0.01, 0, 0],
    [0, 0, 0.01, 0],
    [0, 0, 0, 0.01],
  ];
  private readonly R: number[][] = [
    [5.0, 0],
    [0, 5.0],
  ];
  private readonly H: number[][] = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
  ];

  update(zx: number, zy: number, dt: number): { x: number; y: number } {
    // ── Predict: x = F·x, P = F·P·Fᵀ + Q ──
    const F = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    this.x = matVec(F, this.x);
    this.P = addMat(matMul(matMul(F, this.P), transpose(F)), this.Q);

    // ── Update ──
    const Hx = matVec(this.H, this.x);
    const y = [zx - Hx[0], zy - Hx[1]];

    const S = addMat(matMul(matMul(this.H, this.P), transpose(this.H)), this.R); // 2x2
    const Sinv = invert2x2(S);
    const K = matMul(matMul(this.P, transpose(this.H)), Sinv); // 4x2

    for (let i = 0; i < 4; i++) {
      this.x[i] += K[i][0] * y[0] + K[i][1] * y[1];
    }

    // P = (I - K·H) · P
    const KH = matMul(K, this.H); // 4x4
    const IKH = addMat(identity(4), KH.map((row) => row.map((v) => -v)));
    this.P = matMul(IKH, this.P);

    return { x: this.x[0], y: this.x[1] };
  }
}

// ─────────────────────────────────────────────
// LENS UNDISTORTION — ported from LensUndistort (FusionEngine.cs)
// ─────────────────────────────────────────────

/** Ported from LensUndistort.UndistortPoint - 20 fixed-point iterations of the standard
 * Brown-Conrady radial/tangential distortion inverse, matching the C# source exactly. */
export function undistortPoint(
  px: number,
  py: number,
  K: number[][],
  D: number[],
): { x: number; y: number } {
  const fx = K[0][0];
  const fy = K[1][1];
  const cx = K[0][2];
  const cy = K[1][2];

  let x = (px - cx) / fx;
  let y = (py - cy) / fy;

  const k1 = D.length > 0 ? D[0] : 0;
  const k2 = D.length > 1 ? D[1] : 0;
  const p1 = D.length > 2 ? D[2] : 0;
  const p2 = D.length > 3 ? D[3] : 0;
  const k3 = D.length > 4 ? D[4] : 0;

  const x0 = x;
  const y0 = y;
  for (let iter = 0; iter < 20; iter++) {
    const r2 = x * x + y * y;
    const r4 = r2 * r2;
    const r6 = r4 * r2;
    const radial = 1.0 + k1 * r2 + k2 * r4 + k3 * r6;
    const tangX = 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
    const tangY = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
    x = (x0 - tangX) / radial;
    y = (y0 - tangY) / radial;
  }
  return { x: x * fx + cx, y: y * fy + cy };
}

// ─────────────────────────────────────────────
// CAMERA INTRINSICS (dead code, stage 1) — ported from FusionCameraIntrinsics.Load (FusionEngine.cs)
//
// NOT called anywhere in FusionRunner.RunAsync, or anywhere else in the C# server (verified by
// repo-wide grep for `FusionCameraIntrinsics`) - the real runtime path loads intrinsics from
// database (loadIntrinsics below) instead. Ported only for structural parity with the source
// file's stage layout.
//
// The C# version deserializes full YAML via YamlDotNet. This server has no YAML dependency and
// package.json is off-limits for this port, so this is a minimal parser for exactly the two keys
// this unreachable path ever reads - `camera_matrix` (3 flow-style rows) and
// `distortion_coefficients` (one flow-style list, optionally nested one level, matching the C#
// `outer[0] is List<object> ? outer[0] : outer` fallback) - not a general YAML parser.
// ─────────────────────────────────────────────

export async function loadCameraIntrinsicsFromYamlFile(path: string): Promise<FusionCameraIntrinsics | null> {
  const ws = getWorkstation();
  if (!(await ws.exists(path))) return null;
  return parseIntrinsicsYaml(await ws.readText(path));
}

export function parseIntrinsicsYaml(yamlText: string): FusionCameraIntrinsics | null {
  const cameraMatrix = extractMatrixRows(yamlText, "camera_matrix", 3);
  if (!cameraMatrix) return null;

  const distCoeffs = extractFlatOrNestedList(yamlText, "distortion_coefficients");
  if (!distCoeffs) return null;

  return { cameraMatrix, distCoeffs };
}

function extractFlowList(text: string): number[] | null {
  const m = /\[([^\]]*)]/.exec(text);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);
}

function extractMatrixRows(yamlText: string, key: string, rows: number): number[][] | null {
  const keyIdx = yamlText.indexOf(`${key}:`);
  if (keyIdx < 0) return null;
  const after = yamlText.slice(keyIdx + key.length + 1);
  const rowMatches = after.match(/-\s*\[[^\]]*]/g);
  if (!rowMatches || rowMatches.length < rows) return null;

  const matrix: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const row = extractFlowList(rowMatches[i]);
    if (!row) return null;
    matrix.push(row);
  }
  return matrix;
}

function extractFlatOrNestedList(yamlText: string, key: string): number[] | null {
  const keyIdx = yamlText.indexOf(`${key}:`);
  if (keyIdx < 0) return null;
  const after = yamlText.slice(keyIdx + key.length + 1);
  const listMatch = /-\s*\[[^\]]*]/.exec(after) ?? /\[[^\]]*]/.exec(after);
  if (!listMatch) return null;
  return extractFlowList(listMatch[0]);
}

// ─────────────────────────────────────────────
// CONFIG LOADER (stage 2) — ported from FusionConfigLoader (FusionEngine.cs), now backed by Postgres
// ─────────────────────────────────────────────

/** Must be kept in sync with MAC_PREFIX_TO_MODEL in camera_onboard.py, same as the C# source. */
const MacPrefixToModel: Record<string, string> = {
  "d0:3b:f4": "ANNKE",
};

function detectModelFromMac(mac: string): string | null {
  const normalized = mac.trim().toLowerCase();
  for (const [prefix, model] of Object.entries(MacPrefixToModel)) {
    if (normalized.startsWith(prefix.toLowerCase())) return model;
  }
  return null;
}

function tryGetMac(id: string, storedMac: string | null | undefined): string | null {
  if (typeof storedMac === "string" && storedMac.trim() !== "") {
    return storedMac.toLowerCase().trim();
  }
  const idx = id.indexOf("_");
  if (idx < 1 || idx === id.length - 1) return null;
  return id.slice(idx + 1).toLowerCase();
}

function tryParseMatrix3x3Flat(flat: unknown): number[][] | null {
  if (!Array.isArray(flat) || flat.length !== 9) return null;
  const matrix: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 9; i++) matrix[Math.floor(i / 3)][i % 3] = Number(flat[i]);
  return matrix;
}

/** Ported from ParseHomographyDoc. NOTE: UsedUndistortedImage is hardcoded false in the C#
 * source too (no field is read for it) - faithfully preserved rather than "fixed", per the
 * porting brief. This makes the undistortion branch in applyWorldTransform effectively dead
 * for any homography loaded through this path, exactly as in the original. */
function parseHomographyRow(row: { matrixFlat: number[] | null }): HomographyEntry | null {
  const matrix = tryParseMatrix3x3Flat(row.matrixFlat);
  if (!matrix) return null;
  return { matrix, usedUndistortedImage: false };
}

function parseIntrinsicsRow(row: {
  cameraMatrixFlat: number[] | null;
  distortionCoefficients: number[] | null;
}): FusionCameraIntrinsics | null {
  const cameraMatrix = tryParseMatrix3x3Flat(row.cameraMatrixFlat);
  if (!cameraMatrix) return null;

  const distRaw = row.distortionCoefficients;
  if (!Array.isArray(distRaw)) return null;

  return { cameraMatrix, distCoeffs: distRaw.map(Number) };
}

/** Ported from FusionConfigLoader.LoadHomographiesAsync. */
export async function loadHomographies(
  cameraMacs: Set<string>,
  db: Db = getDb(),
): Promise<Map<string, HomographyEntry>> {
  const result = new Map<string, HomographyEntry>();

  let rows: Array<typeof lockedHomographies.$inferSelect>;
  try {
    rows = await db.select().from(lockedHomographies);
  } catch (err) {
    console.warn(`[WARN] Could not read locked_homographies: ${err instanceof Error ? err.message : err}`);
    return result;
  }

  for (const row of rows) {
    const mac = tryGetMac(row.id, row.cameraMac);
    if (!mac || !cameraMacs.has(mac)) continue;

    const entry = parseHomographyRow(row);
    if (entry) {
      result.set(mac, entry);
      console.log(`[INFO] Homography loaded: ${row.id}`);
    } else {
      console.warn(`[WARN] Homography row ${row.id} could not be parsed — skipped.`);
    }
  }

  if (result.size === 0) {
    console.warn("[WARN] No homographies found in locked_homographies for the active cameras.");
  }

  return result;
}

/** Ported from FusionConfigLoader.LoadIntrinsicsAsync (two-pass per-unit + model-level fallback). */
export async function loadIntrinsics(
  cameraMacs: Set<string>,
  db: Db = getDb(),
): Promise<Map<string, FusionCameraIntrinsics>> {
  const result = new Map<string, FusionCameraIntrinsics>();

  let rows: Array<typeof cameraIntrinsics.$inferSelect>;
  try {
    rows = await db.select().from(cameraIntrinsics);
  } catch (err) {
    console.warn(
      `[WARN] Could not read camera_intrinsics: ${err instanceof Error ? err.message : err} — undistortion skipped.`,
    );
    return result;
  }

  // Index model-level docs (IsPerUnit == false, no CameraMac) by their doc ID (= ModelId) so we
  // can fall back to them for MACs whose per-unit doc is missing.
  const modelDocs = new Map<string, typeof cameraIntrinsics.$inferSelect>();

  // First pass: per-unit docs matched by CameraMac field or {deviceId}_{mac} doc ID.
  for (const data of rows) {
    const hasCameraMac = typeof data.cameraMac === "string" && data.cameraMac.trim() !== "";

    if (!hasCameraMac && !data.isPerUnit) {
      modelDocs.set(data.id, data);
      continue;
    }

    const mac = tryGetMac(data.id, data.cameraMac);
    if (!mac || !cameraMacs.has(mac)) continue;

    const intrinsics = parseIntrinsicsRow(data);
    if (intrinsics) {
      result.set(mac, intrinsics);
      console.log(`[INFO] Intrinsics loaded: ${data.id}`);
    } else {
      console.warn(`[WARN] Intrinsics row ${data.id} could not be parsed — undistortion skipped for cam=${mac}.`);
    }
  }

  // Second pass: for any MAC still unresolved, detect its model from the MAC prefix and look up
  // the corresponding model-level doc.
  const unresolved = Array.from(cameraMacs).filter((m) => !result.has(m));
  if (unresolved.length > 0 && modelDocs.size > 0) {
    for (const mac of unresolved) {
      const modelId = detectModelFromMac(mac);
      const modelDoc = modelId ? modelDocs.get(modelId) : undefined;
      if (!modelId || !modelDoc) {
        console.warn(`[WARN] cam=${mac}: no per-unit intrinsics and no matching model-level doc — undistortion skipped.`);
        continue;
      }

      const intrinsics = parseIntrinsicsRow(modelDoc);
      if (intrinsics) {
        result.set(mac, intrinsics);
        console.log(`[INFO] Intrinsics for cam=${mac} resolved from model-level doc '${modelId}'.`);
      } else {
        console.warn(`[WARN] cam=${mac}: model-level doc '${modelId}' could not be parsed — undistortion skipped.`);
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────
// JSONL LOADER (stage 3) — ported from JsonlLoader (FusionEngine.cs)
// ─────────────────────────────────────────────

function trackKey(mac: string, sid: number): string {
  return `${mac} ${sid}`;
}

export interface ParsedJsonl {
  vectors: Map<string, number[][]>;
  tracks: Map<string, TrackEvent[]>;
}

/** Ported from JsonlLoader.Load. Operates on already-split, already-merged JSONL lines rather
 * than a file path - the caller (runFusionEngine, stage 9) owns file discovery/merging. */
export function parseJsonl(lines: string[]): ParsedJsonl {
  const vectors = new Map<string, number[][]>();
  const tracks = new Map<string, TrackEvent[]>();

  for (const line of lines) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line) as Record<string, unknown>;

    const mac = typeof obj.mac === "string" ? obj.mac.toLowerCase() : undefined;
    const sid = typeof obj.sid === "number" ? obj.sid : undefined;
    const type = typeof obj.type === "string" ? obj.type : undefined;
    if (mac === undefined || sid === undefined || type === undefined) continue;

    const key = trackKey(mac, sid);

    if (type === "vector") {
      const vector = (obj.vector as unknown[]).map(Number);
      if (!vectors.has(key)) vectors.set(key, []);
      vectors.get(key)!.push(vector);
    } else if (type === "track") {
      const time = typeof obj.time === "number" ? obj.time : 0;
      const x = typeof obj.x === "number" ? obj.x : 0;
      const y = typeof obj.y === "number" ? obj.y : 0;
      if (!tracks.has(key)) tracks.set(key, []);
      tracks.get(key)!.push({ x, y, time, cam: mac, sid });
    }
  }

  return { vectors, tracks };
}

// ─────────────────────────────────────────────
// TRACK BUILDER (stage 4) — ported from TrackBuilder (FusionEngine.cs)
// ─────────────────────────────────────────────

export function buildTracks(vectors: Map<string, number[][]>, tracks: Map<string, TrackEvent[]>): TrackObject[] {
  const objs: TrackObject[] = [];

  for (const [key, vecs] of vectors) {
    const evsRaw = tracks.get(key);
    if (!evsRaw || evsRaw.length === 0) continue;

    const evs = [...evsRaw].sort((a, b) => a.time - b.time);
    const rep = mean(vecs);
    const sep = key.indexOf(" ");
    const cam = key.slice(0, sep);
    const sid = Number(key.slice(sep + 1));

    objs.push({
      cam,
      sid,
      rep,
      tStart: evs[0].time,
      tEnd: evs[evs.length - 1].time,
      x: evs[evs.length - 1].x,
      y: evs[evs.length - 1].y,
      events: evs,
    });
  }

  return objs.sort((a, b) => a.tStart - b.tStart);
}

// ─────────────────────────────────────────────
// HOMOGRAPHY TRANSFORM (stage 5) — ported from WorldTransform (FusionEngine.cs)
// ─────────────────────────────────────────────

/** Ported from WorldTransform.Apply. Mutates each TrackObject's events (and final x/y) in place,
 * same as the C# source. Note: a track with zero events will throw here (`.events[...]` on an
 * empty array), matching `track.Events.Last()` throwing in C# for the same input. */
export function applyWorldTransform(
  trackObjs: TrackObject[],
  homographies: Map<string, HomographyEntry>,
  intrinsicsPerCam?: Map<string, FusionCameraIntrinsics>,
): void {
  for (const track of trackObjs) {
    const entry = homographies.get(track.cam.toLowerCase());
    if (!entry) {
      console.warn(`[WARN] No homography for cam=${track.cam} — skipped.`);
      continue;
    }

    const intrinsics = intrinsicsPerCam?.get(track.cam.toLowerCase());
    const doUndist = entry.usedUndistortedImage && intrinsics != null;

    if (entry.usedUndistortedImage && !intrinsics) {
      console.warn(
        `[WARN] cam=${track.cam}: homography expects undistorted input but no intrinsics found in camera_intrinsics.`,
      );
    }

    const H = entry.matrix;
    const kf = new Kalman2D();
    let prevT: number | null = null;

    for (const e of track.events) {
      let ux = e.x;
      let uy = e.y;

      if (doUndist && intrinsics) {
        const u = undistortPoint(e.x, e.y, intrinsics.cameraMatrix, intrinsics.distCoeffs);
        ux = u.x;
        uy = u.y;
      }

      const p0 = H[0][0] * ux + H[0][1] * uy + H[0][2];
      const p1 = H[1][0] * ux + H[1][1] * uy + H[1][2];
      const p2 = H[2][0] * ux + H[2][1] * uy + H[2][2];

      if (Math.abs(p2) < 1e-9) continue;

      const wx = p0 / p2;
      const wy = p1 / p2;

      const dt = prevT === null ? 0.0 : Math.max(1e-3, (e.time - prevT) / 1000.0);

      const { x: fx, y: fy } = kf.update(wx, wy, dt);
      e.x = fx;
      e.y = fy;
      prevT = e.time;
    }

    const last = track.events[track.events.length - 1];
    track.x = last.x;
    track.y = last.y;
  }
}

// ─────────────────────────────────────────────
// FUSION ENGINE (stage 6) — ported from FusionEngine.Run/TeleportMetrics/TimeCompatible/Overlaps
// This is the core matching decision: which tracks get merged into the same global identity.
// ─────────────────────────────────────────────

/** Ported from FusionEngine.TeleportMetrics. Distance between the gid's last known position and
 * the new track's FIRST position, divided by the elapsed time end-of-old → start-of-new.
 * Negative/zero gaps are treated as teleports (time-inverted or simultaneous). */
function teleportMetrics(
  gid: FusedIdentity,
  track: TrackObject,
): { teleport: boolean; dist: number; dtMs: number; speed: number } {
  const trackStart = track.events[0];
  const dx = trackStart.x - gid.x;
  const dy = trackStart.y - gid.y;
  const dist = hypot(dx, dy);
  const dtMs = track.tStart - gid.tEnd;

  if (dtMs <= 0) {
    return { teleport: true, dist, dtMs, speed: Number.POSITIVE_INFINITY };
  }

  if (dist > FusionEngineConfig.MaxJumpFusion) {
    return { teleport: true, dist, dtMs, speed: dist / (dtMs / 1000.0) };
  }

  const speed = dist / (dtMs / 1000.0);
  return { teleport: speed > FusionEngineConfig.MaxSpeedWorldPerS, dist, dtMs, speed };
}

/** Ported from FusionEngine.TimeCompatible. Rejects negative gaps too - a new track can't start
 * before the gid ended. */
function timeCompatible(gid: FusedIdentity, track: TrackObject): { ok: boolean; gapMs: number } {
  const gap = track.tStart - gid.tEnd;
  return { ok: gap >= 0 && gap <= FusionEngineConfig.MaxGapMs, gapMs: gap };
}

/** Ported from FusionEngine.Overlaps. True if the candidate track shares a camera with ANY
 * segment already fused into the gid AND its time window overlaps that segment. */
function overlaps(gid: FusedIdentity, track: TrackObject): boolean {
  for (const seg of gid.tracks) {
    if (seg.length === 0) continue;
    if (seg[0].cam !== track.cam) continue;
    const segStart = seg[0].time;
    const segEnd = seg[seg.length - 1].time;
    if (track.tStart <= segEnd && track.tEnd >= segStart) return true;
  }
  return false;
}

/** Ported from FusionEngine.Run (FusionEngine.cs) - the core fusion/matching algorithm.
 * Assumes trackObjs is already sorted by tStart ascending (TrackBuilder.build does this),
 * same precondition as the C# source. */
export function runFusion(trackObjs: TrackObject[], debug = false): FusedIdentity[] {
  const gids: FusedIdentity[] = [];
  let nextGid = 0;

  for (const track of trackObjs) {
    let best: FusedIdentity | null = null;
    let bestSim = -1;

    if (debug) console.log(`\n[FUSION] track cam=${track.cam} sid=${track.sid}`);

    for (const candidate of gids) {
      const { teleport, dist, dtMs, speed } = teleportMetrics(candidate, track);
      if (teleport) {
        if (debug) {
          console.log(
            `  gid=${candidate.gid} rejected (teleport) dist=${dist.toFixed(2)} dt=${dtMs}ms speed=${speed.toFixed(2)}`,
          );
        }
        continue;
      }

      if (overlaps(candidate, track)) {
        if (debug) console.log(`  gid=${candidate.gid} rejected (time overlap - same camera)`);
        continue;
      }

      const { ok: okTime, gapMs } = timeCompatible(candidate, track);
      if (!okTime) {
        if (debug) console.log(`  gid=${candidate.gid} rejected (time gap) gap=${gapMs}ms`);
        continue;
      }

      const sim = cosineSimilarity(track.rep, candidate.rep);
      if (debug) console.log(`  gid=${candidate.gid} sim=${sim.toFixed(3)}`);

      if (sim < FusionEngineConfig.SimThreshold) {
        if (debug) console.log("     rejected (low similarity)");
        continue;
      }

      if (sim > bestSim) {
        bestSim = sim;
        best = candidate;
      }
    }

    if (best === null) {
      if (debug) console.log("  → NEW GID");
      gids.push({
        gid: nextGid++,
        rep: track.rep,
        tStart: track.tStart,
        tEnd: track.tEnd,
        x: track.x,
        y: track.y,
        tracks: [track.events],
        sources: [],
      });
    } else {
      if (debug) console.log(`  → MERGED into gid=${best.gid} (sim=${bestSim.toFixed(3)})`);
      best.rep = averageReps(best.rep, track.rep);
      best.tEnd = track.tEnd;
      best.x = track.x;
      best.y = track.y;
      best.tracks.push(track.events);
    }
  }

  for (const gid of gids) {
    const flat = gid.tracks.flat().sort((a, b) => a.time - b.time);
    gid.tracks = [flat];

    const seen = new Set<string>();
    const sources: { cam: string; sid: number }[] = [];
    for (const e of flat) {
      const key = trackKey(e.cam, e.sid);
      if (!seen.has(key)) {
        seen.add(key);
        sources.push({ cam: e.cam, sid: e.sid });
      }
    }
    gid.sources = sources;
  }

  return gids;
}

// ─────────────────────────────────────────────
// TRACK CLEANING (stage 7) — ported from TrackCleaner (FusionEngine.cs)
// ─────────────────────────────────────────────

function removeDuplicates(track: TrackEvent[]): TrackEvent[] {
  if (track.length === 0) return track;
  const cleaned: TrackEvent[] = [track[0]];
  for (const p of track.slice(1)) {
    const prev = cleaned[cleaned.length - 1];
    if (Math.abs(p.x - prev.x) > FusionEngineConfig.DupEps || Math.abs(p.y - prev.y) > FusionEngineConfig.DupEps) {
      cleaned.push(p);
    }
  }
  return cleaned;
}

function removeLargeJumps(track: TrackEvent[]): TrackEvent[] {
  if (track.length === 0) return track;
  const cleaned: TrackEvent[] = [track[0]];
  for (const p of track.slice(1)) {
    const prev = cleaned[cleaned.length - 1];
    if (p.cam !== prev.cam) {
      cleaned.push(p);
      continue;
    }
    const d = hypot(p.x - prev.x, p.y - prev.y);
    if (d < FusionEngineConfig.MaxJumpClean) cleaned.push(p);
  }
  return cleaned;
}

function smoothTrack(track: TrackEvent[]): TrackEvent[] {
  const n = track.length;
  const win = FusionEngineConfig.SmoothWin;
  const result: TrackEvent[] = [];
  for (let i = 0; i < n; i++) {
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) {
      sx += track[j].x;
      sy += track[j].y;
      count++;
    }
    result.push({ x: sx / count, y: sy / count, time: track[i].time, cam: track[i].cam, sid: track[i].sid });
  }
  return result;
}

/** Ported from TrackCleaner.Clean. Returns null if the cleaned track is too short/brief to keep. */
export function cleanTrack(track: TrackEvent[]): TrackEvent[] | null {
  if (track.length === 0) return null;
  let cleaned = removeDuplicates(track);
  cleaned = removeLargeJumps(cleaned);
  cleaned = smoothTrack(cleaned);
  const duration = (cleaned[cleaned.length - 1].time - cleaned[0].time) / 1000.0;
  if (cleaned.length < FusionEngineConfig.MinTrackPoints || duration < FusionEngineConfig.MinDurationS) return null;
  return cleaned;
}

// ─────────────────────────────────────────────
// EXPORTER (stage 8) — ported from FusionExporter (FusionEngine.cs)
// ─────────────────────────────────────────────

export interface FusionExportEntry {
  sources: { cam: string; sid: number }[];
  num_events: number;
  tracks: { x: number; y: number; t: number; cam: string }[];
}

/** Ported from FusionExporter.Export. Builds the JSON object in memory rather than streaming to
 * disk via Utf8JsonWriter - the C# version streamed purely to bound peak memory on very large
 * runs; this server serializes once and uploads directly to storage (see runFusionEngine, stage 9),
 * so there's no local-file step to stream into. Same shape: {"0": {...}, "1": {...}, ...}. */
export function exportFusionResult(gids: FusedIdentity[]): Record<string, FusionExportEntry> {
  const output: Record<string, FusionExportEntry> = {};
  let idx = 0;

  for (const g of gids) {
    const flatEvents = g.tracks.flat();
    const cleaned = cleanTrack(flatEvents);
    if (!cleaned) continue;

    output[String(idx)] = {
      sources: g.sources.map((s) => ({ cam: s.cam, sid: s.sid })),
      num_events: cleaned.length,
      tracks: cleaned.map((e) => ({ x: e.x, y: e.y, t: e.time, cam: e.cam })),
    };
    idx++;
  }

  return output;
}

// ─────────────────────────────────────────────
// ORCHESTRATION RUNNER (stage 9) — ported from FusionRunner.RunAsync (FusionEngine.cs)
//
// Storage I/O: cloudStorageService.ts exposes signed-URL creation plus whole-object
// upload/download; the folder listing needed here goes straight to getStorageBucket()
// (config/storage.ts), mirroring CloudStorageService.cs's ListFilesAsync.
// ─────────────────────────────────────────────

interface StorageFileInfo {
  storagePath: string;
  lastModified: Date;
}

async function listStorageFiles(folder: string): Promise<StorageFileInfo[]> {
  // Normalise the folder so sibling folders sharing a prefix (e.g. "tracks-raw2") never match.
  const dir = folder.replace(/^\/+|\/+$/g, "");
  const pageSize = 1000;
  const out: StorageFileInfo[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await getStorageBucket().list(dir, { limit: pageSize, offset });
    if (error || !data) throw new Error(`Failed to list storage folder '${folder}': ${error?.message ?? "unknown error"}`);
    for (const f of data) {
      // Supabase returns sub-folders as entries with a null updated_at; only files are wanted.
      if (f.updated_at === null || f.name.endsWith("/")) continue;
      out.push({
        storagePath: dir ? `${dir}/${f.name}` : f.name,
        lastModified: f.updated_at ? new Date(f.updated_at) : new Date(0),
      });
    }
    if (data.length < pageSize) break;
  }
  return out;
}

async function downloadStorageText(storagePath: string): Promise<string> {
  return (await downloadObject(storagePath)).toString("utf-8");
}

async function uploadStorageText(storagePath: string, contentType: string, text: string): Promise<void> {
  await uploadObject(storagePath, contentType, Buffer.from(text, "utf-8"));
}

/** Raw byte download for GET /:runId/download - mirrors CloudStorageService.DownloadBytesAsync. */
export async function downloadStorageBytes(storagePath: string): Promise<Buffer> {
  return downloadObject(storagePath);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const reason = signal.reason;
    throw reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : "Aborted");
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

function truncateToUtcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Ported from FusionRunner's local `ParseTimestampFromName` closure - expects
 * "...-yyyyMMdd-HHmmss...ext" file names, e.g. "cam1-20250408-143512.jsonl". */
function parseTimestampFromName(storagePath: string): Date | null {
  const name = storagePath.split("/").pop() ?? "";
  const dash = name.indexOf("-");
  if (dash < 0 || dash + 16 > name.length) return null;
  const token = name.substring(dash + 1, dash + 16);
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(token);
  if (!m) return null;
  const [, yyyy, MM, dd, HH, mm, ss] = m;
  const t = Date.UTC(Number(yyyy), Number(MM) - 1, Number(dd), Number(HH), Number(mm), Number(ss));
  return Number.isNaN(t) ? null : new Date(t);
}

/** Ported from FusionRunner.DownloadAndMergeTracksForRangeAsync. Downloads every JSONL file in
 * `folder` whose timestamp falls within [rangeFrom, rangeToExclusive) and concatenates their
 * non-blank lines in chronological order.
 *
 * Deviation from the C# source: kept entirely in memory rather than staged through a local temp
 * directory - functionally identical (same filter/merge order), simpler for a containerized
 * Express service with no shared local disk to clean up. */
async function downloadAndMergeTracksForRange(
  folder: string,
  rangeFrom: Date,
  rangeToExclusive: Date,
  signal?: AbortSignal,
): Promise<string[]> {
  const allFiles = await listStorageFiles(folder);
  if (allFiles.length === 0) {
    throw new Error(`No track files found in storage folder '${folder}'.`);
  }

  const rangeFiles = allFiles
    .map((f) => ({ file: f, timestamp: parseTimestampFromName(f.storagePath) ?? f.lastModified }))
    .filter((x) => x.timestamp.getTime() >= rangeFrom.getTime() && x.timestamp.getTime() < rangeToExclusive.getTime())
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  if (rangeFiles.length === 0) {
    throw new Error(
      `No track files found in '${folder}' between ${isoDate(rangeFrom)} and ${isoDate(addUtcDays(rangeToExclusive, -1))} (inclusive).`,
    );
  }

  console.log(
    `[INFO] Found ${rangeFiles.length} track file(s) between ${isoDate(rangeFrom)} and ${isoDate(addUtcDays(rangeToExclusive, -1))}:`,
  );
  for (const f of rangeFiles) console.log(`       ${f.file.storagePath}  (${f.timestamp.toISOString()})`);

  throwIfAborted(signal);

  // Download all parts in parallel (max 4 concurrent), same cap as Parallel.ForEachAsync in the source.
  const contents = await mapWithConcurrency(rangeFiles, 4, (item) => downloadStorageText(item.file.storagePath));

  const mergedLines: string[] = [];
  for (const text of contents) {
    for (const line of text.split(/\r?\n/)) {
      if (line.trim().length > 0) mergedLines.push(line);
    }
  }

  console.log(`[INFO] Merged ${rangeFiles.length} file(s) → ${mergedLines.length} line(s)`);
  return mergedLines;
}

export interface RunFusionEngineOptions {
  /** Cancellation - checked at the same checkpoints ct.ThrowIfCancellationRequested() was in the C# source. */
  signal?: AbortSignal;
  debug?: boolean;
}

/** Ported from FusionRunner.RunAsync (FusionEngine.cs) - the async orchestration runner, stage 9.
 * Downloads + merges the raw JSONL tracks for the requested date range from storage, builds tracks,
 * loads homographies/intrinsics from Postgres, world-transforms, fuses, cleans, and uploads the
 * fused result JSON back to storage. */
export async function runFusionEngine(request: FusionRequest, options: RunFusionEngineOptions = {}): Promise<FusionResult> {
  const { signal, debug = false } = options;

  if (!request.from || !request.to || Number.isNaN(request.from.getTime()) || Number.isNaN(request.to.getTime())) {
    return {
      success: false,
      message:
        "FusionRequest.from and FusionRequest.to are required. Supply the date range selected in the calendar.",
    };
  }

  const rangeFrom = truncateToUtcDate(request.from); // inclusive start (UTC date)
  const toDateTruncated = truncateToUtcDate(request.to);
  const rangeToExclusive = addUtcDays(toDateTruncated, 1); // exclusive end (start of next day)

  if (rangeFrom.getTime() >= rangeToExclusive.getTime()) {
    return {
      success: false,
      message: `From (${isoDate(rangeFrom)}) must be before To (${isoDate(addUtcDays(rangeToExclusive, -1))}).`,
    };
  }

  try {
    // ── 1. Discover, download, and merge JSONL files in the date range ──
    const inputFolder = (request.inputStorageFolder ?? FusionEngineConfig.InputStorageFolder).replace(/\/+$/, "");
    let mergedLines = await downloadAndMergeTracksForRange(inputFolder, rangeFrom, rangeToExclusive, signal);

    // ── 2. Fine-grained millisecond filter over the merged JSONL ──
    // Always applied when a range is provided so partial-day selections at the boundary are
    // handled precisely. Mirrors FusionRunner.FilterByTime.
    const fineFromMs = request.from.getTime();
    const fineToMs = addUtcDays(toDateTruncated, 1).getTime() - 1;
    mergedLines = mergedLines.filter((line) => {
      if (!line.trim()) return false;
      const obj = JSON.parse(line) as { time?: number };
      return typeof obj.time === "number" && obj.time >= fineFromMs && obj.time <= fineToMs;
    });

    // ── 3. Load + build tracks ──
    throwIfAborted(signal);
    const { vectors, tracks } = parseJsonl(mergedLines);
    const trackObjs = buildTracks(vectors, tracks);

    // ── 4. Collect the unique camera MACs present in this batch ──
    const activeMacs = new Set(trackObjs.map((t) => t.cam.toLowerCase()));
    console.log(`[INFO] Active cameras: ${Array.from(activeMacs).join(", ")}`);

    // ── 5. Fetch homographies + intrinsics from Postgres ──
    const homographies = await loadHomographies(activeMacs);
    const intrinsicsDict = await loadIntrinsics(activeMacs);

    // ── 6. World transform (undistortion + homography + Kalman) ──
    throwIfAborted(signal);
    applyWorldTransform(trackObjs, homographies, intrinsicsDict);

    // ── 7. Fuse identities ──
    throwIfAborted(signal);
    const gids = runFusion(trackObjs, debug);

    // ── 8. Serialize + upload result to storage ──
    throwIfAborted(signal);
    const exportObj = exportFusionResult(gids);

    const fromStr = yyyymmdd(rangeFrom);
    const toStr = yyyymmdd(addUtcDays(rangeToExclusive, -1)); // back to inclusive
    const outputFolder = (request.outputStorageFolder ?? FusionEngineConfig.OutputStorageFolder).replace(/\/+$/, "");
    const outputStoragePath =
      fromStr === toStr
        ? `${outputFolder}/fused_tracks-${fromStr}.json`
        : `${outputFolder}/fused_tracks-${fromStr}_${toStr}.json`;

    console.log(`[INFO] Uploading result to: ${outputStoragePath}`);
    await uploadStorageText(outputStoragePath, "application/json", JSON.stringify(exportObj, null, 2));

    console.log(`[DONE] ${gids.length} fused identities written to ${outputStoragePath}`);

    return { success: true, message: "" };
  } catch (err) {
    if (signal?.aborted) throw err; // let the caller (fusionService) see the real cancellation
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ERROR] ${message}`);
    return { success: false, message };
  }
}

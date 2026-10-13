import path from "node:path";
import { env } from "../config/env.js";
import { getWorkstation } from "../workstation/index.js";
import type { ActiveTrackSummary, PathPoint, TrackingPath, TrackingPoint3D, TrackingPosition } from "../models/tracking.js";

/**
 * Ported from BetterPlacemaking.SERVER/Services/TrackingDataService.cs and
 * CoordinateTransformService.cs (themselves ported from P2BP-25_26-Visualizer
 * GalleryModelApi). Unlike the other *Service.ts files in this project, this is
 * NOT a Firestore CRUD layer - tracking data is a filesystem artifact of the
 * offline CV pipeline: a rolling CSV of recent per-frame detections
 * (Tracking:PositionsCsv) and one JSON file per finished track
 * (Tracking:TracksDir). Both are read fresh on every call, matching the
 * original's no-caching behavior.
 */

async function readLines(filePath: string): Promise<string[]> {
  const content = await getWorkstation().readText(filePath);
  const lines = content.split(/\r\n|\r|\n/);
  // File.ReadAllLines in .NET does not yield a trailing empty entry for a file
  // that ends with a newline; String.split does, so drop it to match.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function parseIntStrict(s: string): number | null {
  if (!/^-?\d+$/.test(s.trim())) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function parseFloatStrict(s: string): number | null {
  const n = Number(s.trim());
  return s.trim().length > 0 && Number.isFinite(n) ? n : null;
}

function parseTimestamp(s: string): Date | null {
  // DateTime.Parse(s, InvariantCulture) accepts both "T"- and space-separated
  // ISO-ish timestamps; Date's parser is stricter about the separator.
  const candidate = new Date(s);
  if (!Number.isNaN(candidate.getTime())) return candidate;
  const withT = new Date(s.trim().replace(" ", "T"));
  return Number.isNaN(withT.getTime()) ? null : withT;
}

/**
 * Mirrors ParsePositionLine. Only XGround/YGround are parsed leniently (TryParse
 * in the original) - every other field failing to parse invalidates the whole
 * line (Parse, which throws and is caught by the caller).
 */
function parsePositionLine(line: string): TrackingPosition | null {
  if (!line || !line.trim()) return null;
  const parts = line.split(",");

  if (parts.length === 11) {
    const globalId = parseIntStrict(parts[0]);
    const frameIdx = parseIntStrict(parts[2]);
    const timestamp = parseTimestamp(parts[3]);
    const x1 = parseFloatStrict(parts[6]);
    const y1 = parseFloatStrict(parts[7]);
    const x2 = parseFloatStrict(parts[8]);
    const y2 = parseFloatStrict(parts[9]);
    const confidence = parseFloatStrict(parts[10]);
    if (globalId === null || frameIdx === null || !timestamp || x1 === null || y1 === null || x2 === null || y2 === null || confidence === null) {
      return null;
    }
    return {
      GlobalId: globalId,
      CameraId: parts[1],
      FrameIdx: frameIdx,
      Timestamp: timestamp.toISOString(),
      XGround: parseFloatStrict(parts[4]),
      YGround: parseFloatStrict(parts[5]),
      X1: x1,
      Y1: y1,
      X2: x2,
      Y2: y2,
      Confidence: confidence,
    };
  }

  if (parts.length === 9) {
    const globalId = parseIntStrict(parts[0]);
    const frameIdx = parseIntStrict(parts[2]);
    const timestamp = parseTimestamp(parts[3]);
    const x1 = parseFloatStrict(parts[4]);
    const y1 = parseFloatStrict(parts[5]);
    const x2 = parseFloatStrict(parts[6]);
    const y2 = parseFloatStrict(parts[7]);
    const confidence = parseFloatStrict(parts[8]);
    if (globalId === null || frameIdx === null || !timestamp || x1 === null || y1 === null || x2 === null || y2 === null || confidence === null) {
      return null;
    }
    return {
      GlobalId: globalId,
      CameraId: parts[1],
      FrameIdx: frameIdx,
      Timestamp: timestamp.toISOString(),
      XGround: null,
      YGround: null,
      X1: x1,
      Y1: y1,
      X2: x2,
      Y2: y2,
      Confidence: confidence,
    };
  }

  return null;
}

/** Mirrors TrackingDataService.GetRecentPositions. */
export async function getRecentPositions(limit = 1000): Promise<TrackingPosition[]> {
  const csvPath = env.trackingPositionsCsv;
  if (!csvPath || !(await getWorkstation().exists(csvPath))) {
    return [];
  }

  const lines = await readLines(csvPath);
  const startIndex = lines.length > 0 && lines[0].includes("global_id") ? 1 : 0;
  const endIndex = Math.max(startIndex, lines.length - limit);

  const positions: TrackingPosition[] = [];
  for (let i = lines.length - 1; i >= endIndex && positions.length < limit; i--) {
    const position = parsePositionLine(lines[i]);
    if (position) positions.unshift(position);
  }
  return positions;
}

/** Mirrors CoordinateTransformService.TransformCameraToLidar. */
function transformCameraToLidar(xGround: number, yGround: number): TrackingPoint3D {
  const { trackingOffsetX: offsetX, trackingOffsetY: offsetY, trackingOffsetZ: offsetZ, trackingRotationAngle: rotationAngle, trackingScaleX: scaleX, trackingScaleZ: scaleZ } = env;

  const scaledX = xGround * scaleX;
  const scaledZ = yGround * scaleZ;

  const angleRad = (rotationAngle * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rotatedX = scaledX * cos - scaledZ * sin;
  const rotatedZ = scaledX * sin + scaledZ * cos;

  return {
    X: rotatedX + offsetX,
    Y: offsetY,
    Z: rotatedZ + offsetZ,
  };
}

/** Mirrors LoadTrackFromJson - returns null (and logs) on any malformed track file, same as the original. */
async function loadTrackFromJson(filePath: string): Promise<TrackingPath | null> {
  try {
    const json = await getWorkstation().readText(filePath);
    const root = JSON.parse(json) as {
      global_id: number;
      local_cam?: string | null;
      first_seen_frame: number;
      last_seen_frame: number;
      positions: unknown[][];
    };

    const globalId = root.global_id;
    const localCam = root.local_cam ?? "";
    const firstSeenFrame = root.first_seen_frame;
    const lastSeenFrame = root.last_seen_frame;
    const positionsArray = root.positions ?? [];

    const pathPoints: PathPoint[] = [];
    let startTime: Date | null = null;
    let endTime: Date | null = null;

    for (const pos of positionsArray) {
      // pos[0], pos[2], pos[3] are read (and discarded) by the original too -
      // kept here only as an index-shape check, matching its intent.
      const gx = Number(pos[4]);
      const gy = Number(pos[5]);

      let timestamp: Date;
      if (typeof pos[1] === "number") {
        timestamp = new Date(pos[1] * 1000);
      } else if (typeof pos[1] === "string") {
        const parsed = parseTimestamp(pos[1]);
        if (!parsed) continue;
        timestamp = parsed;
      } else {
        continue;
      }

      const transformed = transformCameraToLidar(gx, gy);
      pathPoints.push({ Position: transformed, Timestamp: timestamp.toISOString() });

      if (!startTime || timestamp < startTime) startTime = timestamp;
      if (!endTime || timestamp > endTime) endTime = timestamp;
    }

    if (pathPoints.length === 0) return null;

    const now = new Date();
    return {
      GlobalId: globalId,
      CameraId: localCam,
      Id: path.basename(filePath, ".json"),
      IndividualId: String(globalId),
      Points: pathPoints,
      StartTime: (startTime ?? now).toISOString(),
      EndTime: (endTime ?? now).toISOString(),
      FirstSeenFrame: firstSeenFrame,
      LastSeenFrame: lastSeenFrame,
      NumDetections: pathPoints.length,
    };
  } catch (err) {
    console.error(`Error parsing track JSON from ${filePath}`, err);
    return null;
  }
}

/** Mirrors TrackingDataService.GetAllTracks. */
export async function getAllTracks(): Promise<TrackingPath[]> {
  const tracksDir = env.trackingTracksDir;
  if (!tracksDir || !(await getWorkstation().exists(tracksDir))) {
    return [];
  }

  const jsonFiles = (await getWorkstation().listNames(tracksDir)).filter((f) => f.endsWith(".json"));

  const tracks: TrackingPath[] = [];
  for (const file of jsonFiles) {
    const track = await loadTrackFromJson(path.join(tracksDir, file));
    if (track) tracks.push(track);
  }
  return tracks;
}

/** Mirrors TrackingDataService.GetTrackByGlobalId. */
export async function getTrackByGlobalId(globalId: number): Promise<TrackingPath | null> {
  const tracks = await getAllTracks();
  return tracks.find((t) => t.GlobalId === globalId) ?? null;
}

/** Mirrors TrackingDataService.GetActiveTracks. */
export async function getActiveTracks(seconds = 30): Promise<ActiveTrackSummary[]> {
  const cutoffTime = new Date(Date.now() - seconds * 1000);
  const tracks = await getAllTracks();
  const activeTracks = tracks.filter((t) => new Date(t.EndTime) >= cutoffTime);

  const recentPositions = await getRecentPositions(1000);

  const results: ActiveTrackSummary[] = [];
  for (const track of activeTracks) {
    const lastPoint = [...track.Points].sort(
      (a, b) => new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime(),
    )[0];
    if (!lastPoint) continue;

    const latestPos = recentPositions
      .filter((p) => p.GlobalId === track.GlobalId)
      .sort((a, b) => new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime())[0];

    if (latestPos && latestPos.XGround != null && latestPos.YGround != null) {
      results.push({
        globalId: track.GlobalId,
        latestPosition: {
          xGround: latestPos.XGround,
          yGround: latestPos.YGround,
          timestamp: new Date(latestPos.Timestamp).toISOString(),
        },
      });
    }
  }
  return results;
}

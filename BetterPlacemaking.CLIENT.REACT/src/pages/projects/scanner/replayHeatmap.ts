import type { Matrix3, TrackingFloorplan, TrackingPerson } from "../../../lib/trackingTypes";

/**
 * Trail segment rules shared by the replay trails and the dwell heatmap, and the dwell heatmap
 * itself: person-seconds per square world cell over a loaded range. Pure, no React.
 */

/** Consecutive samples further apart in time than this (ms) break the trail. */
export const TRAIL_GAP_MS = 2_000;
/** Consecutive samples farther apart than this (world metres) break the trail. */
export const TRAIL_JUMP_M = 1.0;
/** Heatmap cell edge in world metres. */
export const HEATMAP_CELL_M = 0.25;

/**
 * True when sample i starts a new trail segment: the first sample, a time gap over TRAIL_GAP_MS,
 * or a jump over TRAIL_JUMP_M (measured in world metres, before projection).
 */
export function isBreakAt(p: TrackingPerson, i: number): boolean {
  if (i <= 0) return true;
  return p.t[i] - p.t[i - 1] > TRAIL_GAP_MS || Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) > TRAIL_JUMP_M;
}

/** Axis-aligned world rectangle in metres. */
export interface WorldExtent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DwellGrid {
  /** World cell index of the grid's first column and row: cell (c, r) spans [c * cell, (c + 1) * cell). */
  c0: number;
  r0: number;
  cell: number;
  cols: number;
  rows: number;
  /** Person-seconds per cell, row-major: index = (r - r0) * cols + (c - c0), r grows with world y. */
  seconds: Float64Array;
  /** Largest cell value, 0 when nothing accumulated. */
  max: number;
}

function invert3(m: Matrix3): Matrix3 | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [
    [A * k, -(b * i - c * h) * k, (b * f - c * e) * k],
    [B * k, (a * i - c * g) * k, -(a * f - c * d) * k],
    [C * k, -(a * h - b * g) * k, (a * e - b * d) * k],
  ];
}

/** World extent covered by the floor plan image: its four corners mapped back through T_gt2px. */
export function floorplanWorldExtent(fp: TrackingFloorplan): WorldExtent | null {
  const inv = invert3(fp.T_gt2px);
  if (!inv) return null;
  const ext: WorldExtent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [u, v] of [
    [0, 0],
    [fp.width, 0],
    [0, fp.height],
    [fp.width, fp.height],
  ]) {
    const x = inv[0][0] * u + inv[0][1] * v + inv[0][2];
    const y = inv[1][0] * u + inv[1][1] * v + inv[1][2];
    const w = inv[2][0] * u + inv[2][1] * v + inv[2][2];
    if (w === 0) return null;
    ext.minX = Math.min(ext.minX, x / w);
    ext.maxX = Math.max(ext.maxX, x / w);
    ext.minY = Math.min(ext.minY, y / w);
    ext.maxY = Math.max(ext.maxY, y / w);
  }
  return Number.isFinite(ext.minX) && Number.isFinite(ext.minY) ? ext : null;
}

/**
 * Dwell time per cell. Cells are square, `cell` metres on a side and aligned to the world origin:
 * a point is in cell (floor(x / cell), floor(y / cell)). For consecutive samples of one person
 * inside one trail segment (see isBreakAt), the time between them goes to the cell of the earlier
 * sample; the breaks already bound it at TRAIL_GAP_MS. Every entry of `people` counts on its own,
 * so raw per-camera tracks of the same person add up. A sample outside the extent adds nothing.
 */
export function computeDwellGrid(people: TrackingPerson[], extent: WorldExtent, cell = HEATMAP_CELL_M): DwellGrid {
  const c0 = Math.floor(extent.minX / cell);
  const r0 = Math.floor(extent.minY / cell);
  const cols = Math.floor(extent.maxX / cell) - c0 + 1;
  const rows = Math.floor(extent.maxY / cell) - r0 + 1;
  const seconds = new Float64Array(cols * rows);
  let max = 0;
  for (const p of people) {
    for (let i = 1; i < p.t.length; i++) {
      if (isBreakAt(p, i)) continue;
      const x = p.x[i - 1];
      const y = p.y[i - 1];
      if (!(x >= extent.minX && x <= extent.maxX && y >= extent.minY && y <= extent.maxY)) continue;
      const dt = p.t[i] - p.t[i - 1];
      if (!(dt > 0)) continue;
      const k = (Math.floor(y / cell) - r0) * cols + (Math.floor(x / cell) - c0);
      seconds[k] += dt / 1000;
      if (seconds[k] > max) max = seconds[k];
    }
  }
  return { c0, r0, cell, cols, rows, seconds, max };
}

// Single-hue sequential ramp (blue), light at low dwell to dark at the maximum. Opacity rises with
// the value too, so low-dwell cells let the floor plan show through.
const RAMP_LOW: [number, number, number] = [0x6d, 0xa7, 0xec];
const RAMP_HIGH: [number, number, number] = [0x0d, 0x36, 0x6b];
/** Opacity of the faintest drawn cell, so any recorded time stays visible. */
const ALPHA_MIN = 0.1;
const ALPHA_MAX = 0.85;

/** Fill for a cell at fraction f of the window maximum; f = 0 is fully transparent. */
export function heatColor(f: number): string {
  if (!(f > 0)) return "rgba(109, 167, 236, 0)";
  const g = Math.min(1, f);
  const [r, gg, b] = RAMP_LOW.map((lo, i) => Math.round(lo + g * (RAMP_HIGH[i] - lo)));
  const a = ALPHA_MIN + g * (ALPHA_MAX - ALPHA_MIN);
  return `rgba(${r}, ${gg}, ${b}, ${a.toFixed(3)})`;
}

/** CSS gradient of the ramp for the legend, 0 on the left to the maximum on the right. */
export const HEAT_LEGEND_GRADIENT = `linear-gradient(to right, ${heatColor(0)}, ${heatColor(0.001)}, ${heatColor(0.5)}, ${heatColor(1)})`;

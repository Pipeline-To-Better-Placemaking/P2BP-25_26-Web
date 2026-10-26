import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Matrix3,
  TrackingExportFormat,
  TrackingMeta,
  TrackingMode,
  TrackingPerson,
  TrackingRange,
} from "../../../lib/trackingTypes";
import * as trackingApi from "../../../services/workstationTrackingApi";
import { TrackingLockedError, TrackingRateLimitedError } from "../../../services/workstationTrackingApi";

/**
 * History replay + export of person tracks recorded on the workstation. Data is fetched directly
 * from the workstation over the tailnet (see workstationTrackingApi.ts). While this panel is
 * mounted it holds the workstation's single data lease for the project (heartbeat every 15 s,
 * released on unmount and page unload), so nobody else can pull data at the same time.
 */

const HEARTBEAT_MS = 15_000;
const MAX_RANGE_MS = 6 * 60 * 60 * 1000;
const MAX_EXPORT_MS = 24 * 60 * 60 * 1000;
const TRAIL_GAP_MS = 2_000;
const DOT_LINGER_MS = 1_000;
const PRESETS = [5, 20, 60] as const;
const SPEEDS = [1, 4, 16] as const;
const COLORS = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#42d4f4",
  "#f032e6",
  "#9a6324",
  "#469990",
  "#808000",
  "#000075",
  "#bfef45",
];

type Preset = (typeof PRESETS)[number] | "custom";
type Speed = (typeof SPEEDS)[number];

type LeaseState =
  | { status: "acquiring" }
  | { status: "held"; sessionId: string }
  | { status: "locked"; heldBy: string | null; until: number | null }
  | { status: "error"; message: string; retryAfterSeconds?: number };

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/** Applies a 3x3 homography to [x, y, 1]. */
function applyHomography(T: Matrix3, x: number, y: number): [number, number] {
  const u = T[0][0] * x + T[0][1] * y + T[0][2];
  const v = T[1][0] * x + T[1][1] * y + T[1][2];
  const w = T[2][0] * x + T[2][1] * y + T[2][2];
  return w === 0 ? [u, v] : [u / w, v / w];
}

/** Index of the last sample with t <= time, or -1. `t` must be ascending. */
function lastIndexAtOrBefore(t: number[], time: number): number {
  let lo = 0;
  let hi = t.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= time) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Position at `time`, linearly interpolated between samples closer than TRAIL_GAP_MS. */
function positionAt(p: TrackingPerson, i: number, time: number): [number, number] {
  const j = i + 1;
  if (j < p.t.length && p.t[j] - p.t[i] <= TRAIL_GAP_MS && p.t[j] > p.t[i]) {
    const a = (time - p.t[i]) / (p.t[j] - p.t[i]);
    return [p.x[i] + a * (p.x[j] - p.x[i]), p.y[i] + a * (p.y[j] - p.y[i])];
  }
  return [p.x[i], p.y[i]];
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Epoch ms -> value for a `datetime-local` input (local time, seconds precision). */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** [now - minutes, now] in epoch ms. */
function lastMinutes(minutes: number): { from: number; to: number } {
  const to = Date.now();
  return { from: to - minutes * 60_000, to };
}

function fromLocalInput(s: string): number {
  return s ? new Date(s).getTime() : NaN;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong.";
}

const toggleBtn = (active: boolean) =>
  `rounded-md px-2.5 py-1 text-xs font-medium ${
    active ? "bg-indigo-600 text-white" : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
  } disabled:cursor-not-allowed disabled:opacity-50`;

const actionBtn =
  "rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryBtn =
  "rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50";

// ---------------------------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------------------------

interface TrackingReplayPanelProps {
  projectId: string;
}

export function TrackingReplayPanel({ projectId }: TrackingReplayPanelProps) {
  // Lease -------------------------------------------------------------------------------------
  const [lease, setLease] = useState<LeaseState>({ status: "acquiring" });
  const [attempt, setAttempt] = useState(0);
  /** Stops heartbeating the current lease (set by the lease effect). */
  const stopLeaseRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let cancelled = false;
    let sessionId: string | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let autoRetry: ReturnType<typeof setTimeout> | undefined;

    const release = () => {
      if (sessionId) trackingApi.releaseSession(projectId, sessionId);
      sessionId = null;
    };

    const stop = () => {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
      sessionId = null;
    };
    stopLeaseRef.current = stop;

    const onLost = (err: unknown) => {
      stop();
      if (err instanceof TrackingLockedError) {
        setLease({ status: "locked", heldBy: err.heldBy, until: err.until });
      } else {
        setLease({ status: "error", message: errorMessage(err) });
      }
    };

    // Deferred one tick so a StrictMode mount/unmount/mount only sends one acquire.
    const start = setTimeout(() => {
      setLease({ status: "acquiring" });
      trackingApi
        .acquireSession(projectId, "replay")
        .then((s) => {
          if (cancelled) {
            trackingApi.releaseSession(projectId, s.SessionId);
            return;
          }
          sessionId = s.SessionId;
          setLease({ status: "held", sessionId: s.SessionId });
          heartbeat = setInterval(() => {
            if (!sessionId) return;
            trackingApi.heartbeatSession(projectId, sessionId).catch((err: unknown) => {
              if (cancelled) return;
              // Only a definitive answer ends the lease; transient failures retry next tick.
              if (err instanceof TrackingLockedError) onLost(err);
            });
          }, HEARTBEAT_MS);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (err instanceof TrackingLockedError) {
            setLease({ status: "locked", heldBy: err.heldBy, until: err.until });
          } else if (err instanceof TrackingRateLimitedError) {
            setLease({ status: "error", message: errorMessage(err), retryAfterSeconds: err.retryAfterSeconds });
            autoRetry = setTimeout(() => setAttempt((a) => a + 1), err.retryAfterSeconds * 1000 + 250);
          } else {
            setLease({ status: "error", message: errorMessage(err) });
          }
        });
    }, 0);

    window.addEventListener("pagehide", release);
    window.addEventListener("beforeunload", release);
    return () => {
      cancelled = true;
      clearTimeout(start);
      if (autoRetry) clearTimeout(autoRetry);
      if (heartbeat) clearInterval(heartbeat);
      window.removeEventListener("pagehide", release);
      window.removeEventListener("beforeunload", release);
      release();
    };
  }, [projectId, attempt]);

  const sessionId = lease.status === "held" ? lease.sessionId : null;

  // Meta + floor plan image -------------------------------------------------------------------
  const [meta, setMeta] = useState<TrackingMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [floorImg, setFloorImg] = useState<HTMLImageElement | null>(null);
  const metaLoadedRef = useRef(false);
  const floorUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (floorUrlRef.current) URL.revokeObjectURL(floorUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    // Load once the first lease attempt has resolved (shares its ticket; avoids a second mint).
    if (metaLoadedRef.current || lease.status !== "held") return;
    metaLoadedRef.current = true;
    let cancelled = false;
    let done = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const m = await trackingApi.getMeta(projectId);
        if (cancelled) return;
        setMeta(m);
        if (!m.floorplan) {
          done = true;
          return;
        }
        const blob = await trackingApi.getFloorplanBlob(projectId);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (cancelled || !objectUrl) return;
          done = true;
          floorUrlRef.current = objectUrl;
          setFloorImg(img);
        };
        img.onerror = () => {
          if (!cancelled) setMetaError("The floor plan image could not be decoded.");
        };
        img.src = objectUrl;
      } catch (err) {
        done = true;
        if (!cancelled) {
          metaLoadedRef.current = false;
          setMetaError(`Couldn't load floor plan info: ${errorMessage(err)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
      // Interrupted before finishing: allow the next held lease to load it again.
      if (!done) {
        metaLoadedRef.current = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    };
  }, [projectId, lease.status]);

  // Range controls ----------------------------------------------------------------------------
  const [preset, setPreset] = useState<Preset>(20);
  const [fromInput, setFromInput] = useState(() => toLocalInput(lastMinutes(20).from));
  const [toInput, setToInput] = useState(() => toLocalInput(lastMinutes(20).to));
  const [mode, setMode] = useState<TrackingMode>("stitched");
  const [exportFormat, setExportFormat] = useState<TrackingExportFormat>("csv");
  const [busy, setBusy] = useState<"load" | "export" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const selectPreset = (minutes: (typeof PRESETS)[number]) => {
    const r = lastMinutes(minutes);
    setPreset(minutes);
    setFromInput(toLocalInput(r.from));
    setToInput(toLocalInput(r.to));
  };

  /** Range for the current controls; presets are re-anchored to "now" at the moment of use. */
  const resolveRange = (): { from: number; to: number } | string => {
    let from: number;
    let to: number;
    if (preset === "custom") {
      from = fromLocalInput(fromInput);
      to = fromLocalInput(toInput);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return "Enter a valid From and To time.";
    } else {
      ({ from, to } = lastMinutes(preset));
      setFromInput(toLocalInput(from));
      setToInput(toLocalInput(to));
    }
    if (to <= from) return "To must be after From.";
    return { from, to };
  };

  const handleLeaseFailure = (err: unknown) => {
    if (err instanceof TrackingLockedError) {
      stopLeaseRef.current();
      setLease({ status: "locked", heldBy: err.heldBy, until: err.until });
      return true;
    }
    return false;
  };

  // Playback ----------------------------------------------------------------------------------
  const [data, setData] = useState<TrackingRange | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const playheadRef = useRef(0);
  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  const load = async () => {
    if (!sessionId || busy) return;
    setActionError(null);
    const r = resolveRange();
    if (typeof r === "string") return setActionError(r);
    if (r.to - r.from > MAX_RANGE_MS) return setActionError("Replay is limited to 6 hours. Choose a shorter range.");
    setBusy("load");
    setPlaying(false);
    try {
      const res = await trackingApi.getRange(projectId, sessionId, { from: r.from, to: r.to, mode, hz: 5 });
      setData(res);
      setPlayhead(res.from);
    } catch (err) {
      if (!handleLeaseFailure(err)) setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const doExport = async () => {
    if (!sessionId || busy) return;
    setActionError(null);
    setExportNote(null);
    const r = resolveRange();
    if (typeof r === "string") return setActionError(r);
    if (r.to - r.from > MAX_EXPORT_MS) return setActionError("Export is limited to 24 hours. Choose a shorter range.");
    setBusy("export");
    try {
      await trackingApi.downloadExport(projectId, sessionId, { from: r.from, to: r.to, mode, format: exportFormat });
      setExportNote(`Exported ${fmtDateTime(r.from)} to ${fmtDateTime(r.to)} (${mode}, ${exportFormat.toUpperCase()}).`);
    } catch (err) {
      if (!handleLeaseFailure(err)) setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!playing || !data) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(playheadRef.current + (now - last) * speed, data.to);
      last = now;
      playheadRef.current = next;
      setPlayhead(next);
      if (next >= data.to) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, data]);

  const togglePlay = () => {
    if (!data) return;
    if (!playing && playhead >= data.to) setPlayhead(data.from);
    setPlaying((p) => !p);
  };

  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    data?.people.forEach((p, i) => map.set(p.id, COLORS[i % COLORS.length]));
    return (id: string) => map.get(id) ?? COLORS[0];
  }, [data]);

  // Canvas ------------------------------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.floor(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fp = meta?.floorplan ?? null;
  const aspect = fp ? fp.height / fp.width : 10 / 16;
  const height = Math.max(200, Math.min(Math.round(width * aspect), 640));

  /** World -> canvas CSS px for the current layout. */
  const project = useMemo(() => {
    if (width <= 0) return null;
    if (fp) {
      const s = Math.min(width / fp.width, height / fp.height);
      const ox = (width - fp.width * s) / 2;
      const oy = (height - fp.height * s) / 2;
      return {
        rect: { x: ox, y: oy, w: fp.width * s, h: fp.height * s },
        toCanvas: (x: number, y: number): [number, number] => {
          const [u, v] = applyHomography(fp.T_gt2px, x, y);
          return [ox + u * s, oy + v * s];
        },
      };
    }
    // No floor plan calibration: fit every point (and camera) into the canvas, y up.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (x: number, y: number) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    };
    data?.people.forEach((p) => p.x.forEach((x, i) => add(x, p.y[i])));
    meta?.cameras.forEach((c) => add(c.x, c.y));
    if (!Number.isFinite(minX)) {
      minX = -5;
      maxX = 5;
      minY = -5;
      maxY = 5;
    }
    const padPx = 24;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const s = Math.min((width - 2 * padPx) / spanX, (height - 2 * padPx) / spanY);
    const ox = (width - spanX * s) / 2;
    const oy = (height - spanY * s) / 2;
    return {
      rect: null,
      toCanvas: (x: number, y: number): [number, number] => [ox + (x - minX) * s, height - (oy + (y - minY) * s)],
    };
  }, [width, height, fp, data, meta]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !project) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(width * dpr);
    const ph = Math.round(height * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, 0, width, height);

    if (project.rect) {
      if (floorImg) {
        ctx.drawImage(floorImg, project.rect.x, project.rect.y, project.rect.w, project.rect.h);
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(project.rect.x, project.rect.y, project.rect.w, project.rect.h);
      }
    }

    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";

    for (const cam of meta?.cameras ?? []) {
      const [cx, cy] = project.toCanvas(cam.x, cam.y);
      ctx.fillStyle = "#171717";
      ctx.beginPath();
      ctx.moveTo(cx, cy - 6);
      ctx.lineTo(cx + 5, cy + 4);
      ctx.lineTo(cx - 5, cy + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillText(cam.name, cx + 8, cy);
    }

    if (!data) return;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const p of data.people) {
      const idx = lastIndexAtOrBefore(p.t, playhead);
      if (idx < 0) continue;
      const color = colorOf(p.id);

      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= idx; i++) {
        const [cx, cy] = project.toCanvas(p.x[i], p.y[i]);
        if (i === 0 || p.t[i] - p.t[i - 1] > TRAIL_GAP_MS) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      const [hx, hy] = positionAt(p, idx, playhead);
      const [hcx, hcy] = project.toCanvas(hx, hy);
      if (idx + 1 < p.t.length && p.t[idx + 1] - p.t[idx] <= TRAIL_GAP_MS) ctx.lineTo(hcx, hcy);
      ctx.stroke();
      ctx.globalAlpha = 1;

      const active = playhead <= p.t[p.t.length - 1] + DOT_LINGER_MS;
      if (active) {
        ctx.fillStyle = color;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hcx, hcy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#171717";
        ctx.fillText(p.id, hcx + 9, hcy - 8);
      }
    }
  }, [project, width, height, floorImg, meta, data, playhead, colorOf]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Re-render at the new density when the window moves between screens or zooms.
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const onChange = () => draw();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [draw]);

  // Render ------------------------------------------------------------------------------------
  const held = lease.status === "held";
  const controlsDisabled = !held || busy !== null;
  const empty = data !== null && data.people.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {lease.status === "acquiring" && (
        <p className="rounded-md bg-neutral-50 p-3 text-sm text-neutral-600">Connecting to the workstation...</p>
      )}
      {lease.status === "locked" && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          <span>
            {lease.heldBy
              ? `In use by ${lease.heldBy}, try again after ${lease.until ? fmtTime(lease.until) : "they close it"}.`
              : "Your tracking data session ended. Retry to continue."}
          </span>
          <button type="button" className={secondaryBtn} onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </button>
        </div>
      )}
      {lease.status === "error" && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
          <span>
            {lease.message}
            {lease.retryAfterSeconds ? " Retrying automatically." : ""}
          </span>
          <button type="button" className={secondaryBtn} onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">Range</span>
          <div className="flex gap-1">
            {PRESETS.map((m) => (
              <button key={m} type="button" className={toggleBtn(preset === m)} onClick={() => selectPreset(m)}>
                Last {m} min
              </button>
            ))}
            <button type="button" className={toggleBtn(preset === "custom")} onClick={() => setPreset("custom")}>
              Custom
            </button>
          </div>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
          From
          <input
            type="datetime-local"
            step={1}
            value={fromInput}
            onChange={(e) => {
              setFromInput(e.target.value);
              setPreset("custom");
            }}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
          To
          <input
            type="datetime-local"
            step={1}
            value={toInput}
            onChange={(e) => {
              setToInput(e.target.value);
              setPreset("custom");
            }}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-800"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">IDs</span>
          <div className="flex gap-1">
            <button type="button" className={toggleBtn(mode === "stitched")} onClick={() => setMode("stitched")}>
              Stitched
            </button>
            <button type="button" className={toggleBtn(mode === "raw")} onClick={() => setMode("raw")}>
              Raw
            </button>
          </div>
        </div>
        <button type="button" className={actionBtn} disabled={controlsDisabled} onClick={load}>
          {busy === "load" ? "Loading..." : "Load"}
        </button>
        <div className="ml-auto flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
            Format
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as TrackingExportFormat)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-800"
            >
              <option value="csv">CSV</option>
              <option value="jsonl">JSONL</option>
            </select>
          </label>
          <button type="button" className={secondaryBtn} disabled={controlsDisabled} onClick={doExport}>
            {busy === "export" ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>

      {meta?.span && (
        <p className="text-xs text-neutral-500">
          Recorded data available from {fmtDateTime(meta.span[0])} to {fmtDateTime(meta.span[1])}.
        </p>
      )}
      {metaError && <p className="text-xs text-amber-700">{metaError}</p>}
      {actionError && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{actionError}</p>}
      {exportNote && <p className="text-xs text-green-700">{exportNote}</p>}

      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div ref={containerRef} className="relative w-full overflow-hidden rounded-lg border border-neutral-200">
            <canvas ref={canvasRef} style={{ width: `${width}px`, height: `${height}px`, display: "block" }} />
            {(empty || !data) && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="rounded-md bg-white/85 px-3 py-1.5 text-sm text-neutral-600">
                  {empty ? "No tracking data in this range" : "Choose a range and press Load"}
                </span>
              </div>
            )}
          </div>

          {data && !empty && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className={actionBtn} onClick={togglePlay}>
                {playing ? "Pause" : "Play"}
              </button>
              <div className="flex gap-1">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" className={toggleBtn(speed === s)} onClick={() => setSpeed(s)}>
                    {s}x
                  </button>
                ))}
              </div>
              <input
                type="range"
                min={data.from}
                max={data.to}
                step={100}
                value={playhead}
                onChange={(e) => setPlayhead(Number(e.target.value))}
                className="min-w-[160px] flex-1"
                aria-label="Playback position"
              />
              <span className="font-mono text-sm text-neutral-700">
                {fmtTime(playhead)} ({fmtDuration(playhead - data.from)} / {fmtDuration(data.to - data.from)})
              </span>
            </div>
          )}
        </div>

        {data && !empty && (
          <aside className="w-full shrink-0 rounded-lg border border-neutral-200 bg-white p-3 lg:w-56">
            <h3 className="mb-2 text-sm font-semibold text-neutral-800">
              People ({data.people.length}, {data.mode})
            </h3>
            <ul className="max-h-[480px] space-y-1 overflow-y-auto text-sm">
              {data.people.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colorOf(p.id) }} />
                  <span className="truncate text-neutral-800">{p.id}</span>
                  <span className="ml-auto text-xs text-neutral-500">
                    {p.trackIds.length} {p.trackIds.length === 1 ? "track" : "tracks"}
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}

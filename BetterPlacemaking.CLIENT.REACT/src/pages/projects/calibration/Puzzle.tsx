import { PageHeader } from "../../../components/PageHeader";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { HasPermission } from "../../../auth/HasPermission";
import { Permissions } from "../../../lib/permissions";
import * as homographyApi from "../../../services/homographyApi";
import type { Matrix3x3, PuzzlePieceDto, SaveGlobalHomographiesDto } from "../../../lib/homographyTypes";

/**
 * Ported from BetterPlacemaking.CLIENT/src/app/views/projects/selected/calibration/puzzle/
 * {puzzle.component.ts,puzzle.component.html}. Camera-extrinsic-calibration UI: loads every
 * "ready" puzzle piece (a bird's-eye-view camera image + its local homography) for the
 * project, lets the user calibrate a floorplan pixel<->mm scale, then drag/rotate/scale each
 * piece into place on the floorplan before saving the placements as the project's global
 * homography set.
 *
 * NOT ported: the old component's `HARDCODE_PIECES` dev flag, its bundled
 * `test-puzzle/*.jpg` fixture cameras, and `trimWhiteBorder()` (only ever called from the
 * hardcoded-pieces path). None of that is reachable from the real API-backed flow
 * (`loadPiece`/HARDCODE_PIECES=false), and the fixture assets don't exist in this project.
 * Also dropped: `fitHomographyToCanvas`/`matMul3x3` helper methods, which were unused dead
 * code in the original (never called outside of each other), and the debug `console.log`
 * calls in `draw()`/`onKeyDown`.
 */

interface LayerState {
  puzzlePieceId: string;
  deviceId: string;
  cameraMac: string;
  macTag: string;
  bevImage: HTMLImageElement;
  hLocalCanvas: Matrix3x3;
  centerFp: [number, number];
  angleDeg: number;
  scale: number;
  loaded: boolean;
}

interface TrackPoint {
  mac: string;
  x: number;
  y: number;
}

const MAX_DISPLAY_DIM = 1200;
const OPACITY = 0.75;
const ROTATE_STEP = 1;
const SCALE_STEP = 1.02;
const NUDGE_PX = 10;
const TRACK_COLORS = [
  "#ff0000",
  "#00cc00",
  "#0000ff",
  "#cccc00",
  "#cc00cc",
  "#00cccc",
  "#ff8800",
  "#8800ff",
  "#88ff00",
  "#ff8888",
];

function ControlRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-2 text-ink-muted">
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-flex h-6 min-w-[28px] items-center justify-center rounded border border-slate-300 bg-slate-100 px-1.5 font-mono text-xs text-ink"
        >
          {k}
        </kbd>
      ))}
      <span className="ml-auto text-ink-muted">{label}</span>
    </div>
  );
}

function ControlGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand-600">{title}</p>
      {children}
    </div>
  );
}

export function Puzzle() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const floorplanId = searchParams.get("floorplanId");
  const floorplanUrl = searchParams.get("floorplanUrl");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const floorplanImgRef = useRef<HTMLImageElement>(new Image());
  const layersRef = useRef<LayerState[]>([]);
  const draggingRef = useRef(false);
  const lastXYRef = useRef<[number, number]>([0, 0]);
  const fpRef = useRef({ fpW: 0, fpH: 0, dscale: 1 });
  const originFpRef = useRef<[number, number]>([0, 0]);
  const mmPerFpPxRef = useRef(1);
  // Populated externally in the old component only via the (unused, never-assigned-to)
  // `trackPoints` field - ported as a stable empty array so the toggle/draw logic behaves
  // identically (harmlessly draws nothing) until a future phase wires real track data in.
  const trackPointsRef = useRef<TrackPoint[]>([]);

  const [mode, setMode] = useState<"calibrate" | "puzzle">("calibrate");
  const [calPoints, setCalPoints] = useState<[number, number][]>([]);
  const [calDistanceMm, setCalDistanceMm] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [revealedCount, setRevealedCount] = useState(1);
  const [showTrackPoints, setShowTrackPoints] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bumped whenever a ref-held value that the JSX below reads directly (layers.length, a
  // layer's macTag/angleDeg/scale) changes outside of the state setters above - forces a
  // re-render so that JSX re-reads the refs. draw() itself is imperative canvas work and
  // does not need this; it's called directly after every mutation.
  const [, setTick] = useState(0);
  const forceRender = useCallback(() => setTick((c) => c + 1), []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const { dscale } = fpRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(floorplanImgRef.current, 0, 0, canvas.width, canvas.height);

    if (mode === "calibrate") {
      for (const pt of calPoints) {
        ctx.beginPath();
        ctx.arc(pt[0] * dscale, pt[1] * dscale, 6, 0, Math.PI * 2);
        ctx.fillStyle = "red";
        ctx.fill();
      }
      if (calPoints.length === 2) {
        ctx.beginPath();
        ctx.moveTo(calPoints[0][0] * dscale, calPoints[0][1] * dscale);
        ctx.lineTo(calPoints[1][0] * dscale, calPoints[1][1] * dscale);
        ctx.strokeStyle = "red";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      return;
    }

    const layers = layersRef.current;
    for (let i = 0; i < revealedCount && i < layers.length; i++) {
      const layer = layers[i];
      if (!layer.loaded) continue;

      const cx = layer.centerFp[0] * dscale;
      const cy = layer.centerFp[1] * dscale;
      const angle = (layer.angleDeg * Math.PI) / 180;
      const imgW = layer.bevImage.naturalWidth;
      const imgH = layer.bevImage.naturalHeight;

      ctx.save();
      ctx.globalAlpha = OPACITY;
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.scale(layer.scale * dscale, layer.scale * dscale);
      ctx.drawImage(layer.bevImage, -imgW / 2, -imgH / 2);
      ctx.restore();
    }

    if (showTrackPoints && trackPointsRef.current.length > 0) {
      ctx.globalAlpha = 1;
      const camColors: Record<string, string> = {};
      let colorIdx = 0;
      for (const layer of layers) {
        if (!camColors[layer.macTag]) {
          camColors[layer.macTag] = TRACK_COLORS[colorIdx % TRACK_COLORS.length];
          colorIdx++;
        }
      }
      for (const pt of trackPointsRef.current) {
        const layer = layers.find((l) => l.macTag === pt.mac);
        if (!layer) continue;

        const lw = layer.bevImage.naturalWidth;
        const lh = layer.bevImage.naturalHeight;
        const pivotX = lw / 2;
        const pivotY = lh / 2;
        const a = (layer.angleDeg * Math.PI) / 180;
        const cos = Math.cos(a) * layer.scale;
        const sin = Math.sin(a) * layer.scale;
        const cx = layer.centerFp[0];
        const cy = layer.centerFp[1];
        const transform: Matrix3x3 = [
          [cos, -sin, cx - cos * pivotX + sin * pivotY],
          [sin, cos, cy - sin * pivotX - cos * pivotY],
          [0, 0, 1],
        ];
        const h = layer.hLocalCanvas;
        const m: Matrix3x3 = [
          [
            transform[0][0] * h[0][0] + transform[0][1] * h[1][0] + transform[0][2] * h[2][0],
            transform[0][0] * h[0][1] + transform[0][1] * h[1][1] + transform[0][2] * h[2][1],
            transform[0][0] * h[0][2] + transform[0][1] * h[1][2] + transform[0][2] * h[2][2],
          ],
          [
            transform[1][0] * h[0][0] + transform[1][1] * h[1][0] + transform[1][2] * h[2][0],
            transform[1][0] * h[0][1] + transform[1][1] * h[1][1] + transform[1][2] * h[2][1],
            transform[1][0] * h[0][2] + transform[1][1] * h[1][2] + transform[1][2] * h[2][2],
          ],
          [
            transform[2][0] * h[0][0] + transform[2][1] * h[1][0] + transform[2][2] * h[2][0],
            transform[2][0] * h[0][1] + transform[2][1] * h[1][1] + transform[2][2] * h[2][1],
            transform[2][0] * h[0][2] + transform[2][1] * h[1][2] + transform[2][2] * h[2][2],
          ],
        ];
        const wx = m[0][0] * pt.x + m[0][1] * pt.y + m[0][2];
        const wy = m[1][0] * pt.x + m[1][1] * pt.y + m[1][2];
        const w = m[2][0] * pt.x + m[2][1] * pt.y + m[2][2];
        if (Math.abs(w) < 1e-10) continue;
        const dispX = (wx / w) * dscale;
        const dispY = (wy / w) * dscale;
        if (dispX >= 0 && dispX < canvas.width && dispY >= 0 && dispY < canvas.height) {
          ctx.beginPath();
          ctx.arc(dispX, dispY, 3, 0, Math.PI * 2);
          ctx.fillStyle = camColors[pt.mac] || "#ffffff";
          ctx.fill();
        }
      }
    }

    ctx.globalAlpha = 1;
    const layer = layers[selectedIndex];
    if (layer) {
      const trackTag = showTrackPoints ? "  [TRACKS]" : "";
      const text = `${selectedIndex + 1}/${layers.length} ${layer.macTag} rot=${layer.angleDeg.toFixed(1)} scale=${layer.scale.toFixed(3)}${trackTag}`;
      ctx.font = "16px monospace";
      ctx.fillStyle = "black";
      ctx.fillText(text, 11, 26);
      ctx.fillStyle = "white";
      ctx.fillText(text, 10, 25);
    }
  }, [mode, calPoints, revealedCount, showTrackPoints, selectedIndex]);

  // Redraw whenever any of draw()'s React-state inputs change (Tab/B navigation, calibration
  // clicks, track toggle). Drag/rotate/scale/nudge mutate layer fields on the ref directly and
  // call draw() themselves - see onKeyDown/onMouseMove below.
  useEffect(() => {
    draw();
  }, [draw]);

  const loadPiece = useCallback(
    (piece: PuzzlePieceDto) => {
      const metadata = piece.Metadata;
      if (!metadata || !piece.PuzzlePieceDownloadUrl) return;

      const img = new Image();
      const { fpW, fpH } = fpRef.current;
      const layer: LayerState = {
        puzzlePieceId: piece.PuzzlePieceId,
        deviceId: piece.DeviceId,
        cameraMac: piece.CameraMac,
        macTag: piece.CameraMac.replace(/:/g, "_"),
        bevImage: img,
        hLocalCanvas: metadata.HLocalCanvas,
        centerFp: [fpW / 2, fpH / 2],
        angleDeg: 0,
        scale: 1,
        loaded: false,
      };
      img.onload = () => {
        const current = fpRef.current;
        if (current.fpW > 0 && img.naturalWidth > 0) {
          layer.scale = (current.fpW * 0.2) / img.naturalWidth;
        }
        layer.loaded = true;
        draw();
        forceRender();
      };
      img.src = piece.PuzzlePieceDownloadUrl;
      layersRef.current.push(layer);
      forceRender();
    },
    [draw, forceRender],
  );

  const applyWorkspacePieces = useCallback(
    (pieces: PuzzlePieceDto[]) => {
      const ready = pieces.filter((p) => p.Status === "ready" && p.PuzzlePieceDownloadUrl && p.Metadata);
      if (ready.length === 0) {
        setError("No puzzle pieces ready. Ensure ChArUco homography scans have completed.");
        return;
      }
      setError(null);
      ready.forEach((piece) => loadPiece(piece));
    },
    [loadPiece],
  );

  // Load the floorplan image (initCanvas equivalent).
  useEffect(() => {
    if (!floorplanUrl) {
      setError("No floorplan URL provided.");
      return;
    }
    const img = floorplanImgRef.current;
    img.onload = () => {
      const fpW = img.naturalWidth;
      const fpH = img.naturalHeight;
      const dscale = Math.min(1, MAX_DISPLAY_DIM / Math.max(fpW, fpH));
      fpRef.current = { fpW, fpH, dscale };
      originFpRef.current = [0, fpH - 1];

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = Math.round(fpW * dscale);
        canvas.height = Math.round(fpH * dscale);
      }

      // Centre any already-loaded layers now that floorplan dimensions are known.
      for (const layer of layersRef.current) {
        if (layer.centerFp[0] === 0 && layer.centerFp[1] === 0) {
          layer.centerFp = [fpW / 2, fpH / 2];
        }
      }
      draw();
    };
    img.src = floorplanUrl;
  }, [floorplanUrl, draw]);

  // Load the puzzle workspace (loadWorkspace equivalent).
  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    homographyApi
      .getPuzzleWorkspace(projectId)
      .then((workspace) => {
        setLoading(false);
        applyWorkspacePieces(workspace.PuzzlePieces);
      })
      .catch(() => setLoading(false));
    // Runs once per project on mount, same as the old ngAfterViewInit - applyWorkspacePieces
    // itself is stable aside from loadPiece's draw/forceRender deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function refresh() {
    if (!projectId || refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const workspace = await homographyApi.refreshPuzzlePieces(projectId);
      layersRef.current = [];
      setSelectedIndex(0);
      setRevealedCount(1);
      applyWorkspacePieces(workspace.PuzzlePieces);
    } catch {
      setError("Failed to refresh puzzle pieces.");
    } finally {
      setRefreshing(false);
    }
  }

  function onMouseDown(e: MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (mode === "calibrate") {
      if (calPoints.length < 2) {
        const { dscale } = fpRef.current;
        setCalPoints((pts) => [...pts, [x / dscale, y / dscale]]);
      }
      return;
    }

    draggingRef.current = true;
    lastXYRef.current = [x, y];
  }

  function onMouseMove(e: MouseEvent<HTMLCanvasElement>) {
    if (!draggingRef.current || mode !== "puzzle") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { dscale } = fpRef.current;

    const [lastX, lastY] = lastXYRef.current;
    const dx = (x - lastX) / dscale;
    const dy = (y - lastY) / dscale;
    lastXYRef.current = [x, y];

    const layer = layersRef.current[selectedIndex];
    if (layer) {
      layer.centerFp = [layer.centerFp[0] + dx, layer.centerFp[1] + dy];
      draw();
    }
  }

  function onMouseUp() {
    draggingRef.current = false;
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (mode !== "puzzle") return;
    const layers = layersRef.current;
    const layer = layers[selectedIndex];
    if (!layer || layers.length === 0) return;

    switch (e.key) {
      case "Tab": {
        e.preventDefault();
        const next = (selectedIndex + 1) % layers.length;
        setSelectedIndex(next);
        setRevealedCount((c) => Math.max(c, next + 1));
        break;
      }
      case "b":
      case "B":
        setSelectedIndex((i) => (i - 1 + layers.length) % layers.length);
        break;
      case "[":
        layer.angleDeg -= ROTATE_STEP;
        draw();
        forceRender();
        break;
      case "]":
        layer.angleDeg += ROTATE_STEP;
        draw();
        forceRender();
        break;
      case "-":
        layer.scale /= SCALE_STEP;
        draw();
        forceRender();
        break;
      case "=":
        layer.scale *= SCALE_STEP;
        draw();
        forceRender();
        break;
      case "ArrowUp":
        e.preventDefault();
        layer.centerFp = [layer.centerFp[0], layer.centerFp[1] - NUDGE_PX];
        draw();
        break;
      case "ArrowDown":
        e.preventDefault();
        layer.centerFp = [layer.centerFp[0], layer.centerFp[1] + NUDGE_PX];
        draw();
        break;
      case "ArrowLeft":
        e.preventDefault();
        layer.centerFp = [layer.centerFp[0] - NUDGE_PX, layer.centerFp[1]];
        draw();
        break;
      case "ArrowRight":
        e.preventDefault();
        layer.centerFp = [layer.centerFp[0] + NUDGE_PX, layer.centerFp[1]];
        draw();
        break;
      case "t":
      case "T":
        setShowTrackPoints((v) => !v);
        break;
      default:
        break;
    }
  }

  function finishCalibration() {
    if (calPoints.length !== 2 || calDistanceMm <= 0) return;
    const dx = calPoints[1][0] - calPoints[0][0];
    const dy = calPoints[1][1] - calPoints[0][1];
    const distPx = Math.sqrt(dx * dx + dy * dy);
    if (distPx < 1) return;
    mmPerFpPxRef.current = calDistanceMm / distPx;
    setMode("puzzle");
  }

  async function save() {
    if (saving || !projectId) return;
    setSaveError(null);

    const placements = layersRef.current.map((l) => ({
      PuzzlePieceId: l.puzzlePieceId,
      DeviceId: l.deviceId,
      CameraMac: l.cameraMac,
      CenterFp: [l.centerFp[0], l.centerFp[1]],
      AngleDeg: l.angleDeg,
      Scale: l.scale,
      HLocalCanvas: l.hLocalCanvas,
      LocalCanvasSize: [l.bevImage.naturalWidth, l.bevImage.naturalHeight],
    }));

    const { fpW, fpH } = fpRef.current;
    const payload: SaveGlobalHomographiesDto = {
      FloorplanId: floorplanId ?? null,
      MmPerFpPx: mmPerFpPxRef.current,
      OriginFp: [originFpRef.current[0], originFpRef.current[1]],
      FloorplanSize: [fpW, fpH],
      Placements: placements,
    };

    setSaving(true);
    try {
      await homographyApi.saveGlobalHomographies(projectId, payload);
    } catch {
      setSaveError("Failed to save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const layers = layersRef.current;
  const activeLayer = layers[selectedIndex];

  return (
    <div>
      <PageHeader
        title="Puzzle Calibration"
        actions={
        <HasPermission permission={Permissions.Project.Update} projectId={projectId}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing || loading}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-100 disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh Pieces"}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || mode !== "puzzle" || layers.length === 0}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </HasPermission>
        }
      />

      {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {saveError && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{saveError}</p>}
      {loading && <p className="mt-4 text-sm text-ink-muted">Loading workspace…</p>}

      {mode === "calibrate" && (
        <div className="mt-4 bp-card p-4 text-sm">
          <div className="flex flex-col gap-3">
            <div className={`flex items-center gap-3 ${calPoints.length === 0 ? "" : "opacity-40"}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                1
              </span>
              <span>Click the first reference point on the floorplan</span>
            </div>
            <div className={`flex items-center gap-3 ${calPoints.length === 1 ? "" : "opacity-40"}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                2
              </span>
              <span>Click the second reference point</span>
            </div>
            <div className={`flex items-center gap-3 ${calPoints.length === 2 ? "" : "opacity-40"}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                3
              </span>
              <div className="flex items-center gap-2">
                <label htmlFor="cal-distance-mm" className="text-ink">
                  Enter real-world distance between points (mm):
                </label>
                <input
                  id="cal-distance-mm"
                  type="number"
                  value={calDistanceMm || ""}
                  onChange={(e) => setCalDistanceMm(Number(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") finishCalibration();
                  }}
                  placeholder="e.g. 7391"
                  className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
                <HasPermission permission={Permissions.Project.Update} projectId={projectId}>
                  <button
                    type="button"
                    onClick={finishCalibration}
                    className="rounded-md bg-brand-600 px-3 py-1 text-sm font-medium text-white hover:bg-brand-600/85"
                  >
                    Confirm
                  </button>
                </HasPermission>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2 outline-none focus:ring-2 focus:ring-brand-300"
        >
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            className="cursor-grab active:cursor-grabbing"
          />
        </div>

        <div className="bp-card p-4 text-sm">
          <h3 className="border-b border-slate-200 pb-2 text-xl font-semibold text-ink">Controls</h3>
          <div className="mt-3">
            <ControlGroup title="Navigation">
              <ControlRow keys={["Tab"]} label="Next layer" />
              <ControlRow keys={["B"]} label="Previous layer" />
            </ControlGroup>
            <ControlGroup title="Transform">
              <ControlRow keys={["Drag"]} label="Move layer" />
              <ControlRow keys={["[", "]"]} label="Rotate" />
              <ControlRow keys={["-", "="]} label="Scale" />
              <ControlRow keys={["↑", "↓", "←", "→"]} label="Nudge" />
              <ControlRow keys={["T"]} label="Toggle tracks" />
            </ControlGroup>
            <ControlGroup title="Actions">
              <ControlRow keys={["Save"]} label="Export placements" />
            </ControlGroup>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 bp-card px-4 py-2 font-mono text-sm text-ink">
        <span>
          Layer: {layers.length > 0 ? selectedIndex + 1 : 0}/{layers.length}
          {activeLayer ? ` — ${activeLayer.macTag}` : ""}
        </span>
        <span>Rot: {activeLayer ? activeLayer.angleDeg.toFixed(1) : "0.0"}°</span>
        <span>Scale: {activeLayer ? activeLayer.scale.toFixed(3) : "1.000"}</span>
      </div>
    </div>
  );
}

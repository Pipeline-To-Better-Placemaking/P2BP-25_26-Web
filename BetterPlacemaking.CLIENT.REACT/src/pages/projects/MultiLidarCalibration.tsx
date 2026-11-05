import { PageHeader } from "../../components/PageHeader";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useParams } from "react-router-dom";
import { HasPermission } from "../../auth/HasPermission";
import { Permissions } from "../../lib/permissions";
import * as deviceApi from "../../services/deviceApi";
import * as floorplanLibraryApi from "../../services/floorplanLibraryApi";
import * as scanApi from "../../services/scanApi";
import * as scanCalibrationApi from "../../services/scanCalibrationApi";
import type { DeviceDto } from "../../lib/deviceTypes";
import type { FloorplanLibraryItemDto } from "../../lib/floorplanTypes";
import type { ScanRecordDto } from "../../lib/scanTypes";

/**
 * Ported from BetterPlacemaking.CLIENT/src/app/views/admin/devices/multi-lidar-calibration
 * (multi-lidar-calibration.ts/.html). Combines two or more lidar scans (from this
 * device's scan history and/or freshly-uploaded .xyz files) into one shared
 * coordinate frame: pick a floorplan for scale reference, calibrate mm-per-pixel by
 * clicking two known points, load flattened top-down previews of the chosen scans,
 * drag/rotate/scale each overlay into alignment on the canvas, then save.
 *
 * Route scope: mounted under `:projectId/lidar-calibration` in the old Angular route
 * table (`data: { permission: 'Project.Update' } `) - project-scoped, not global-admin,
 * despite the old Angular folder living under `views/admin/devices/`. See this file's
 * final report for the exact route element to add to App.tsx (not edited here).
 *
 * Standalone AND embeddable: this component is also used inside the (not-yet-ported)
 * bigger "Scanner" page, which owns project/device/floorplan/scan-history state itself
 * and used to pass them down as Angular @Input()s. To support both, `deviceId`,
 * `floorPlan` and `scanHistory` are optional "controlled" props - pass them (even as
 * `null`/`[]`) to have the parent own that state, or omit them entirely to let this
 * component fetch and pick its own (the behavior used when mounted directly as the
 * `lidar-calibration` route, with no parent Scanner page above it).
 *
 * Backend calls, cross-checked against the real route handlers (not just the old
 * Angular services):
 *   - scanCalibration.routes.ts: preview/upload-xyz/combine - REAL, all wired up below.
 *     Note these four endpoints are unauthenticated on the real backend (see that route
 *     file's header comment) - a carried-over gap from the old server, not new here.
 *   - device.routes.ts (GET /project/:projectId) - REAL, used for the device picker
 *     when `deviceId` is not supplied by a parent.
 *   - floorplanLibrary.routes.ts (GET /?projectId=) - REAL, used for the floorplan
 *     picker when `floorPlan` is not supplied by a parent.
 *   - scan.routes.ts (GET /:projectId/:deviceId) - REAL, used for scan history when
 *     `scanHistory` is not supplied by a parent.
 * This page never touches Rplidar or the 3D mesh/point-cloud Visualizer pipeline (both
 * not yet ported) - every preview here is the flattened top-down PNG the real
 * scan-calibration preview endpoint renders server-side, not a raw point cloud. So
 * nothing on this page needs a "not available yet" stub.
 */

type Mode = "select" | "calibrate" | "align" | "done";

interface ClickPoint {
  x: number;
  y: number;
}

interface ScanOverlay {
  scanId: string;
  label: string;
  previewUrl: string;
  image: HTMLImageElement | null;
  xTranslation: number;
  yTranslation: number;
  theta: number;
  scale: number;
  opacity: number;
  visible: boolean;
}

interface UploadedOverlayFile {
  id: string;
  name: string;
  file: File;
}

export interface MultiLidarCalibrationProps {
  /** Defaults to the `:projectId` route param when omitted (standalone page usage). */
  projectId?: string;
  /** Pass (even `null`) to let a parent own device selection; omit for an internal picker. */
  deviceId?: string | null;
  /** Pass (even `null`) to let a parent own floorplan selection; omit for an internal picker. */
  floorPlan?: FloorplanLibraryItemDto | null;
  /** Pass (even `[]`) to let a parent own scan history; omit to self-fetch for the resolved device. */
  scanHistory?: ScanRecordDto[] | null;
  className?: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/** Ported verbatim from the Angular component: renders a flattened top-down PNG preview client-side for a freshly-uploaded .xyz file, before it has been pushed to the backend. */
async function createPreviewImageFromUploadedXyz(file: File): Promise<HTMLImageElement> {
  const text = await file.text();
  const points: { x: number; y: number }[] = [];

  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;

    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

    points.push({ x, y });
  }

  if (points.length === 0) throw new Error("No valid XYZ points found.");

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const canvas = document.createElement("canvas");
  canvas.width = 500;
  canvas.height = 500;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create preview canvas.");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const padding = 30;
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((canvas.width - padding * 2) / spanX, (canvas.height - padding * 2) / spanY);

  ctx.fillStyle = "rgba(0, 120, 255, 0.75)";
  for (const p of points) {
    const px = padding + (p.x - minX) * scale;
    const py = canvas.height - (padding + (p.y - minY) * scale);
    ctx.fillRect(px, py, 1.5, 1.5);
  }

  return loadImage(canvas.toDataURL("image/png"));
}

const INTRO =
  "Calibrate the floorplan first, then select two or more scans (from history and/or uploaded XYZ files), load their flattened overlays, and align them before saving the combined calibration.";
const panelClass = "flex flex-col gap-2 bp-card p-4";
const btnSecondary =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50 disabled:opacity-50";
const btnPrimary =
  "rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-50";
const inputClass =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-ink focus:border-brand-500 focus:outline-none";

/** Stable empty-array fallback so the `scanHistory` memo below doesn't see a new identity every render. */
const EMPTY_SCANS: ScanRecordDto[] = [];

export function MultiLidarCalibration({
  projectId: projectIdProp,
  deviceId: deviceIdProp,
  floorPlan: floorPlanProp,
  scanHistory: scanHistoryProp,
  className,
}: MultiLidarCalibrationProps = {}) {
  const { projectId: routeProjectId } = useParams();
  const projectId = projectIdProp ?? routeProjectId ?? "";

  const deviceControlled = deviceIdProp !== undefined;
  const floorPlanControlled = floorPlanProp !== undefined;
  const scanHistoryControlled = scanHistoryProp !== undefined;

  // ---- core calibration state (mirrors the Angular component's public fields) ----
  const [mode, setMode] = useState<Mode>("select");
  const [selectedScanIds, setSelectedScanIds] = useState<string[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedOverlayFile[]>([]);
  const [selectedUploadedFileIds, setSelectedUploadedFileIds] = useState<string[]>([]);
  const [calPoints, setCalPoints] = useState<ClickPoint[]>([]);
  const [calDistanceMm, setCalDistanceMm] = useState<number | null>(null);
  const [scalarMmPerPixel, setScalarMmPerPixel] = useState<number | null>(null);
  const [outputName, setOutputName] = useState("calibrationScan");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<ScanOverlay[]>([]);
  const [selectedOverlayIndex, setSelectedOverlayIndex] = useState(0);
  const [floorplanLoaded, setFloorplanLoaded] = useState(false);

  // ---- internal device/floorplan/scan-history pickers (standalone usage only) ----
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [internalDeviceId, setInternalDeviceId] = useState<string | null>(null);

  const [floorplans, setFloorplans] = useState<FloorplanLibraryItemDto[]>([]);
  const [floorplansLoading, setFloorplansLoading] = useState(false);
  const [internalFloorplanId, setInternalFloorplanId] = useState<string | null>(null);

  const [scans, setScans] = useState<ScanRecordDto[]>([]);
  const [scansLoading, setScansLoading] = useState(false);

  const deviceId = deviceControlled ? (deviceIdProp ?? null) : internalDeviceId;
  const floorPlan = floorPlanControlled
    ? (floorPlanProp ?? null)
    : (floorplans.find((f) => f.Id === internalFloorplanId) ?? null);
  const scanHistory = scanHistoryControlled ? (scanHistoryProp ?? EMPTY_SCANS) : scans;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const floorplanImgRef = useRef<HTMLImageElement | null>(null);
  const draggingRef = useRef(false);
  const dragStartMouseRef = useRef<ClickPoint | null>(null);
  const dragStartTranslationRef = useRef<ClickPoint | null>(null);

  // ---- fetch devices for the internal picker ----
  useEffect(() => {
    if (deviceControlled || !projectId) return;
    let cancelled = false;
    setDevicesLoading(true);
    deviceApi
      .getDevicesByProject(projectId)
      .then((list) => {
        if (cancelled) return;
        setDevices(list);
        setInternalDeviceId((current) => current ?? list[0]?.Id ?? null);
      })
      .catch(() => {
        if (!cancelled) setSaveError("Failed to load devices for this project.");
      })
      .finally(() => {
        if (!cancelled) setDevicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, deviceControlled]);

  // ---- fetch floorplans for the internal picker ----
  useEffect(() => {
    if (floorPlanControlled || !projectId) return;
    let cancelled = false;
    setFloorplansLoading(true);
    floorplanLibraryApi
      .getFloorplanLibrary(projectId)
      .then((list) => {
        if (cancelled) return;
        setFloorplans(list);
        setInternalFloorplanId((current) => current ?? list[0]?.Id ?? null);
      })
      .catch(() => {
        if (!cancelled) setSaveError("Failed to load floorplans for this project.");
      })
      .finally(() => {
        if (!cancelled) setFloorplansLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, floorPlanControlled]);

  // ---- fetch scan history for the resolved device ----
  useEffect(() => {
    if (scanHistoryControlled) return;
    if (!projectId || !deviceId) {
      setScans([]);
      return;
    }
    let cancelled = false;
    setScansLoading(true);
    scanApi
      .getScans(projectId, deviceId)
      .then((list) => {
        if (!cancelled) setScans(list);
      })
      .catch(() => {
        if (!cancelled) setSaveError("Failed to load scan history for this device.");
      })
      .finally(() => {
        if (!cancelled) setScansLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, deviceId, scanHistoryControlled]);

  const successfulScans = useMemo(
    () => scanHistory.filter((s) => !!s.ObjUrl && ["complete", "done"].includes((s.Status ?? "").toLowerCase())),
    [scanHistory],
  );
  const selectedScans = useMemo(
    () => successfulScans.filter((s) => selectedScanIds.includes(s.Id)),
    [successfulScans, selectedScanIds],
  );
  const selectedOverlay = overlays[selectedOverlayIndex] ?? null;

  // ---- load the floorplan image whenever the resolved floorplan changes ----
  useEffect(() => {
    const url = floorPlan?.ImageDownloadUrl ?? null;
    if (!url) {
      floorplanImgRef.current = null;
      setFloorplanLoaded(false);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      floorplanImgRef.current = img;
      setFloorplanLoaded(true);
      setSaveError(null);
    };
    img.onerror = () => {
      if (cancelled) return;
      floorplanImgRef.current = null;
      setFloorplanLoaded(false);
      setSaveError("Failed to load selected floorplan image.");
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [floorPlan?.ImageDownloadUrl]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(300, Math.floor(rect.width));
    const height = Math.max(300, Math.floor(rect.height));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, w, h);

    if (floorplanLoaded && floorplanImgRef.current) {
      const img = floorplanImgRef.current;
      const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      ctx.drawImage(img, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
    }

    ctx.save();
    ctx.strokeStyle = "rgba(100,116,139,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();
    ctx.restore();

    overlays.forEach((overlay, index) => {
      if (!overlay.visible || !overlay.image) return;
      ctx.save();
      ctx.translate(cx + overlay.xTranslation, cy - overlay.yTranslation);
      ctx.rotate((-overlay.theta * Math.PI) / 180);
      ctx.globalAlpha = overlay.opacity;

      const img = overlay.image;
      const drawW = img.width * overlay.scale;
      const drawH = img.height * overlay.scale;
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);

      if (index === selectedOverlayIndex) {
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 2;
        ctx.strokeRect(-drawW / 2, -drawH / 2, drawW, drawH);
      }
      ctx.restore();
    });

    if (mode === "calibrate") {
      for (const pt of calPoints) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "red";
        ctx.fill();
      }
      if (calPoints.length === 2) {
        const [p1, p2] = calPoints;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = "red";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }, [floorplanLoaded, overlays, selectedOverlayIndex, mode, calPoints]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  function eventToWorld(event: ReactMouseEvent<HTMLCanvasElement>): ClickPoint {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const xCanvas = (event.clientX - rect.left) * scaleX;
    const yCanvas = (event.clientY - rect.top) * scaleY;

    if (mode === "calibrate") {
      return { x: xCanvas, y: yCanvas };
    }
    return { x: xCanvas - canvas.width / 2, y: canvas.height / 2 - yCanvas };
  }

  function updateSelectedOverlay(updater: (o: ScanOverlay) => ScanOverlay) {
    setOverlays((prev) => prev.map((o, i) => (i === selectedOverlayIndex ? updater(o) : o)));
  }

  function resetOverlayStateOnly() {
    setOverlays([]);
    setSelectedOverlayIndex(0);
    setSaveSuccess(false);
  }

  function isScanSelected(scanId: string): boolean {
    return selectedScanIds.includes(scanId);
  }

  function toggleScanSelection(scanId: string) {
    setSelectedScanIds((ids) => (ids.includes(scanId) ? ids.filter((id) => id !== scanId) : [...ids, scanId]));
    resetOverlayStateOnly();
  }

  function isUploadedFileSelected(id: string): boolean {
    return selectedUploadedFileIds.includes(id);
  }

  function toggleUploadedFileSelection(id: string) {
    setSelectedUploadedFileIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    resetOverlayStateOnly();
  }

  function onXyzFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const xyzFiles = files.filter((f) => f.name.toLowerCase().endsWith(".xyz"));
    setUploadedFiles((prev) => [
      ...prev,
      ...xyzFiles.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        file,
      })),
    ]);
    event.target.value = "";
  }

  function removeUploadedFile(id: string) {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id));
    setSelectedUploadedFileIds((ids) => ids.filter((x) => x !== id));
  }

  function startScaleCalibration() {
    if (!floorPlan?.ImageDownloadUrl) {
      setSaveError("A floorplan must be selected first.");
      return;
    }
    if (!floorplanLoaded) {
      setSaveError("The selected floorplan image is still loading.");
      return;
    }
    setSaveError(null);
    setMode("calibrate");
    setCalPoints([]);
    setScalarMmPerPixel(null);
    setSaveSuccess(false);
  }

  function finishCalibration() {
    setSaveError(null);
    if (calPoints.length !== 2) {
      setSaveError("Pick two floorplan reference points first.");
      return;
    }
    if (!calDistanceMm || calDistanceMm <= 0) {
      setSaveError("Enter the real-world distance in millimeters.");
      return;
    }
    const [a, b] = calPoints;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    if (pixelDistance <= 0) {
      setSaveError("Invalid calibration points.");
      return;
    }
    setScalarMmPerPixel(calDistanceMm / pixelDistance);
    setMode("select");
  }

  async function loadSelectedScans() {
    setSaveError(null);

    if (!scalarMmPerPixel) {
      setSaveError("Calibrate the floorplan first.");
      return;
    }

    const selectedUploads = uploadedFiles.filter((f) => selectedUploadedFileIds.includes(f.id));
    const totalSelected = selectedScanIds.length + selectedUploads.length;
    if (totalSelected < 2) {
      setSaveError("Select or upload at least two scans.");
      return;
    }

    const nextOverlays: ScanOverlay[] = [];
    let loadError: string | null = null;

    if (selectedScanIds.length > 0) {
      if (!projectId || !deviceId) {
        setSaveError("Project/device context missing for history scans.");
        return;
      }
      for (const scan of selectedScans) {
        try {
          const previewUrl = scanCalibrationApi.getPreviewUrl(projectId, deviceId, scan.Id);
          const image = await loadImage(previewUrl);
          nextOverlays.push({
            scanId: scan.Id,
            label: `Scan ${scan.Id}`,
            previewUrl,
            image,
            xTranslation: 0,
            yTranslation: 0,
            theta: 0,
            scale: 1,
            opacity: 0.75,
            visible: true,
          });
        } catch {
          loadError = `Failed to load preview for scan ${scan.Id}.`;
        }
      }
    }

    for (const uploaded of selectedUploads) {
      try {
        const image = await createPreviewImageFromUploadedXyz(uploaded.file);
        nextOverlays.push({
          scanId: uploaded.id,
          label: uploaded.name,
          previewUrl: "",
          image,
          xTranslation: 0,
          yTranslation: 0,
          theta: 0,
          scale: 1,
          opacity: 0.75,
          visible: true,
        });
      } catch {
        loadError = `Failed to preview uploaded file ${uploaded.name}.`;
      }
    }

    if (nextOverlays.length > 0) {
      nextOverlays[0].opacity = 1;
    }

    setOverlays(nextOverlays);
    setSelectedOverlayIndex(0);
    if (loadError) setSaveError(loadError);
    setMode("align");
  }

  function selectOverlay(index: number) {
    setSelectedOverlayIndex(index);
    setOverlays((prev) => prev.map((o, i) => ({ ...o, opacity: i === index ? 1 : 0.75 })));
  }

  function rotateSelected(delta: number) {
    if (!selectedOverlay) return;
    updateSelectedOverlay((o) => ({ ...o, theta: Number((o.theta + delta).toFixed(4)) }));
  }

  function nudgeSelected(dx: number, dy: number) {
    if (!selectedOverlay) return;
    updateSelectedOverlay((o) => ({
      ...o,
      xTranslation: Number((o.xTranslation + dx).toFixed(4)),
      yTranslation: Number((o.yTranslation + dy).toFixed(4)),
    }));
  }

  function scaleSelected(delta: number) {
    if (!selectedOverlay) return;
    updateSelectedOverlay((o) => ({ ...o, scale: Math.max(0.05, Number((o.scale + delta).toFixed(3))) }));
  }

  function onWorkspaceKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!selectedOverlay) return;
    const move = event.shiftKey ? 10 : 2;
    const rotate = event.shiftKey ? 10 : 2;
    const scaleStep = event.shiftKey ? 0.1 : 0.025;

    switch (event.key) {
      case "ArrowLeft":
        updateSelectedOverlay((o) => ({ ...o, xTranslation: o.xTranslation - move }));
        break;
      case "ArrowRight":
        updateSelectedOverlay((o) => ({ ...o, xTranslation: o.xTranslation + move }));
        break;
      case "ArrowUp":
        updateSelectedOverlay((o) => ({ ...o, yTranslation: o.yTranslation + move }));
        break;
      case "ArrowDown":
        updateSelectedOverlay((o) => ({ ...o, yTranslation: o.yTranslation - move }));
        break;
      case "[":
        updateSelectedOverlay((o) => ({ ...o, theta: o.theta - rotate }));
        break;
      case "]":
        updateSelectedOverlay((o) => ({ ...o, theta: o.theta + rotate }));
        break;
      case "+":
      case "=":
        updateSelectedOverlay((o) => ({ ...o, scale: o.scale + scaleStep }));
        break;
      case "-":
      case "_":
        updateSelectedOverlay((o) => ({ ...o, scale: Math.max(0.05, o.scale - scaleStep) }));
        break;
      case "0":
        updateSelectedOverlay((o) => ({ ...o, xTranslation: 0, yTranslation: 0, theta: 0, scale: 1 }));
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function onCanvasMouseDown(event: ReactMouseEvent<HTMLCanvasElement>) {
    if (!canvasRef.current) return;
    const point = eventToWorld(event);

    if (mode === "calibrate") {
      if (calPoints.length < 2) {
        setCalPoints((pts) => [...pts, point]);
      }
      return;
    }

    if (mode !== "align" && mode !== "done" && mode !== "select") return;
    if (!selectedOverlay) return;

    draggingRef.current = true;
    dragStartMouseRef.current = point;
    dragStartTranslationRef.current = { x: selectedOverlay.xTranslation, y: selectedOverlay.yTranslation };
  }

  function onCanvasMouseMove(event: ReactMouseEvent<HTMLCanvasElement>) {
    if (!draggingRef.current || !selectedOverlay || !dragStartMouseRef.current || !dragStartTranslationRef.current) return;
    const point = eventToWorld(event);
    const dx = point.x - dragStartMouseRef.current.x;
    const dy = point.y - dragStartMouseRef.current.y;
    const start = dragStartTranslationRef.current;
    updateSelectedOverlay((o) => ({
      ...o,
      xTranslation: Number((start.x + dx).toFixed(4)),
      yTranslation: Number((start.y + dy).toFixed(4)),
    }));
  }

  function onCanvasMouseUp() {
    draggingRef.current = false;
    dragStartMouseRef.current = null;
    dragStartTranslationRef.current = null;
  }

  async function save() {
    setSaveError(null);
    setUploadMessage(null);

    if (!projectId || !deviceId) {
      setSaveError("Project/device context missing.");
      return;
    }
    if (overlays.length < 2) {
      setSaveError("Load at least two scan overlays first.");
      return;
    }

    const selectedUploads = uploadedFiles.filter((f) => selectedUploadedFileIds.includes(f.id));
    let workingOverlays = overlays;

    if (selectedUploads.length > 0) {
      setUploadMessage("Adding uploaded files into storage...");
      try {
        const updated = [...overlays];
        for (const uploaded of selectedUploads) {
          const base64 = await scanCalibrationApi.fileToBase64(uploaded.file);
          const result = await scanCalibrationApi.uploadXyz(projectId, deviceId, base64, uploaded.name);
          const idx = updated.findIndex((o) => o.scanId === uploaded.id);
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], scanId: result.Id, label: result.OriginalFileName || updated[idx].label };
          }
        }
        workingOverlays = updated;
        setOverlays(updated);
      } catch {
        setUploadMessage(null);
        setSaveError("Failed to upload one or more XYZ files.");
        return;
      }
      setUploadMessage(null);
    }

    const payload: scanCalibrationApi.CombineScansRequest = {
      OutputName: outputName || "calibrationScan",
      scalar_mm_per_pixel: scalarMmPerPixel,
      Items: workingOverlays.map((o, index) => ({
        ScanId: o.scanId,
        XTranslation: index === 0 ? 0 : o.xTranslation,
        YTranslation: index === 0 ? 0 : o.yTranslation,
        Theta: index === 0 ? 0 : o.theta,
      })),
    };

    try {
      window.localStorage.setItem(`lidar-scan-calibration-${projectId}`, JSON.stringify(payload));
    } catch {
      // best-effort, matches the old component's unguarded localStorage.setItem
    }

    setSaving(true);
    setSaveSuccess(false);

    try {
      await scanCalibrationApi.combine(projectId, deviceId, payload);
      setSaving(false);
      setSaveSuccess(true);
      setMode("done");
    } catch {
      setSaving(false);
      setSaveError("Failed to combine scans.");
    }
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(`lidar-scan-calibration-${projectId}`);
      if (!raw) {
        setSaveError("No saved calibration found.");
        return;
      }
      const parsed = JSON.parse(raw) as {
        Items?: { ScanId?: string }[];
        OutputName?: string;
        scalar_mm_per_pixel?: number | null;
      };
      setSelectedScanIds((parsed?.Items ?? []).map((x) => x.ScanId).filter((id): id is string => !!id));
      setOutputName(parsed?.OutputName ?? "calibrationScan");
      setScalarMmPerPixel(parsed?.scalar_mm_per_pixel ?? null);
      setSaveError(null);
    } catch {
      setSaveError("Could not load saved calibration.");
    }
  }

  function reset() {
    setSelectedScanIds([]);
    setSelectedUploadedFileIds([]);
    setMode("select");
    setCalPoints([]);
    setCalDistanceMm(null);
    setScalarMmPerPixel(null);
    setOverlays([]);
    setSelectedOverlayIndex(0);
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(false);
    setUploadMessage(null);
    draggingRef.current = false;
    dragStartMouseRef.current = null;
    dragStartTranslationRef.current = null;
    setOutputName("calibrationScan");
  }

  if (!projectId) {
    return <p className="text-sm text-red-700">No project context available.</p>;
  }

  return (
    <HasPermission permission={Permissions.Project.Update} projectId={projectId}>
      {projectIdProp === undefined && <PageHeader title="LiDAR Calibration" subtitle={INTRO} />}
      <div className={`flex flex-col gap-4 ${className ?? ""}`}>
        {projectIdProp !== undefined && <p className="text-sm text-ink-muted">{INTRO}</p>}

        {!deviceControlled && (
          <div className={panelClass}>
            <div className="text-base font-semibold text-ink">Device</div>
            {devicesLoading ? (
              <p className="text-sm text-ink-muted">Loading devices…</p>
            ) : devices.length === 0 ? (
              <p className="text-sm text-ink-muted">No devices assigned to this project.</p>
            ) : (
              <select
                className={inputClass}
                value={internalDeviceId ?? ""}
                onChange={(e) => setInternalDeviceId(e.target.value || null)}
              >
                {devices.map((d) => (
                  <option key={d.Id} value={d.Id}>
                    {d.Name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {!floorPlanControlled && (
          <div className={panelClass}>
            <div className="text-base font-semibold text-ink">Floorplan</div>
            {floorplansLoading ? (
              <p className="text-sm text-ink-muted">Loading floorplans…</p>
            ) : floorplans.length === 0 ? (
              <p className="text-sm text-ink-muted">No floorplans in your library for this project.</p>
            ) : (
              <select
                className={inputClass}
                value={internalFloorplanId ?? ""}
                onChange={(e) => setInternalFloorplanId(e.target.value || null)}
              >
                {floorplans.map((f) => (
                  <option key={f.Id} value={f.Id}>
                    {f.Nickname || f.Id}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {saveError && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</div>}
        {uploadMessage && (
          <div className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-700">{uploadMessage}</div>
        )}
        {saveSuccess && (
          <div className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">Calibration done.</div>
        )}

        {mode === "calibrate" && (
          <div className={panelClass}>
            <div className="text-base font-semibold text-ink">Floorplan Scale Calibration</div>
            <div className="text-sm text-ink-muted">1. Click the first reference point on the floorplan.</div>
            <div className="text-sm text-ink-muted">2. Click the second reference point.</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={calDistanceMm ?? ""}
                onChange={(e) => setCalDistanceMm(e.target.value === "" ? null : Number(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && finishCalibration()}
                placeholder="Real-world distance in mm"
                className={inputClass}
              />
              <button type="button" onClick={finishCalibration} className={btnPrimary}>
                Confirm
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-start gap-6">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className={panelClass}>
              <div className="text-base font-semibold text-ink">Upload XYZ Scans</div>
              <label className="w-fit cursor-pointer">
                <span className={btnSecondary}>Upload XYZ</span>
                <input type="file" accept=".xyz" multiple className="hidden" onChange={onXyzFilesSelected} />
              </label>

              {uploadedFiles.length === 0 ? (
                <div className="text-sm text-ink-muted">No uploaded XYZ scans.</div>
              ) : (
                uploadedFiles.map((file) => (
                  <div key={file.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 p-2">
                    <div className="truncate text-sm text-ink">{file.name}</div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => toggleUploadedFileSelection(file.id)}
                        className={isUploadedFileSelected(file.id) ? btnPrimary : btnSecondary}
                      >
                        {isUploadedFileSelected(file.id) ? "Selected" : "Select"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeUploadedFile(file.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className={panelClass}>
              <div className="text-base font-semibold text-ink">Scan History</div>
              {scansLoading ? (
                <div className="text-sm text-ink-muted">Loading scan history…</div>
              ) : successfulScans.length === 0 ? (
                <div className="text-sm text-ink-muted">No completed scans for this device.</div>
              ) : (
                successfulScans.map((scan) => (
                  <div key={scan.Id} className="flex items-center justify-between gap-2 rounded border border-slate-200 p-2">
                    <div className="truncate text-sm text-ink">Scan {scan.Id}</div>
                    <button
                      type="button"
                      onClick={() => toggleScanSelection(scan.Id)}
                      className={isScanSelected(scan.Id) ? btnPrimary : btnSecondary}
                    >
                      {isScanSelected(scan.Id) ? "Selected" : "Select"}
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={startScaleCalibration} disabled={!floorPlan} className={btnSecondary}>
                Calibrate Floorplan
              </button>
              <button
                type="button"
                onClick={loadSelectedScans}
                disabled={selectedScanIds.length + selectedUploadedFileIds.length < 2 || !scalarMmPerPixel}
                className={btnPrimary}
              >
                Load Selected Scans
              </button>
            </div>

            <div className={panelClass}>
              <div className="text-base font-semibold text-ink">Selected Scans</div>
              {selectedScanIds.length + selectedUploadedFileIds.length === 0 ? (
                <div className="text-sm text-ink-muted">No scans selected.</div>
              ) : (
                <>
                  {selectedScanIds.map((id) => (
                    <div key={id} className="text-sm text-ink">
                      History Scan {id}
                    </div>
                  ))}
                  {uploadedFiles
                    .filter((f) => selectedUploadedFileIds.includes(f.id))
                    .map((f) => (
                      <div key={f.id} className="text-sm text-ink">
                        Uploaded Scan {f.name}
                      </div>
                    ))}
                </>
              )}
              <div className="pt-2 text-xs text-ink-muted">Select at least two scans (history and/or uploaded).</div>
            </div>

            <div className={panelClass}>
              <div className="text-base font-semibold text-ink">Calibration Details</div>
              <div className="text-sm text-ink">
                <span className="font-medium">Floorplan:</span> {floorPlan?.Nickname || "None"}
              </div>
              <div className="text-sm text-ink">
                <span className="font-medium">Scalar (mm/pixel):</span> {scalarMmPerPixel ?? "—"}
              </div>
              <label className="block text-xs font-medium text-ink-muted">
                Output Name
                <input value={outputName} onChange={(e) => setOutputName(e.target.value)} className={`${inputClass} mt-1`} />
              </label>
            </div>
          </div>

          <div className="flex w-full max-w-[40rem] shrink-0 flex-col gap-2" tabIndex={0} onKeyDown={onWorkspaceKeyDown}>
            <div className="text-base font-semibold text-ink">Workspace (center is 0,0)</div>
            <canvas
              ref={canvasRef}
              className="w-full rounded border border-slate-200 bg-slate-100"
              style={{ height: 520 }}
              onMouseDown={onCanvasMouseDown}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              onMouseLeave={onCanvasMouseUp}
            />
            <div className="text-xs text-ink-muted">
              Click an overlay below, then use arrow keys to move, [ / ] to rotate, + / - to scale, and 0 to reset.
            </div>

            {overlays.length > 0 && (
              <div className={`${panelClass} mt-2`}>
                <div className="text-base font-semibold text-ink">Overlay Controls</div>
                {overlays.map((overlay, i) => (
                  <div
                    key={overlay.scanId}
                    onClick={() => selectOverlay(i)}
                    className={`flex cursor-pointer items-center justify-between rounded border p-2 ${
                      selectedOverlayIndex === i ? "border-brand-400 bg-brand-50" : "border-slate-200"
                    }`}
                  >
                    <div className="truncate text-sm text-ink">{overlay.label}</div>
                    <div className="shrink-0 text-xs text-ink-muted">
                      X {overlay.xTranslation}, Y {overlay.yTranslation}, θ {overlay.theta}, S {overlay.scale}
                    </div>
                  </div>
                ))}

                {selectedOverlay && (
                  <div className="flex flex-col gap-2 pt-2">
                    <div className="text-base font-semibold text-ink">Selected Overlay</div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs font-medium text-ink-muted">
                        X Translation
                        <input
                          type="number"
                          value={selectedOverlay.xTranslation}
                          onChange={(e) => updateSelectedOverlay((o) => ({ ...o, xTranslation: Number(e.target.value) }))}
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                      <label className="block text-xs font-medium text-ink-muted">
                        Y Translation
                        <input
                          type="number"
                          value={selectedOverlay.yTranslation}
                          onChange={(e) => updateSelectedOverlay((o) => ({ ...o, yTranslation: Number(e.target.value) }))}
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                      <label className="block text-xs font-medium text-ink-muted">
                        Theta
                        <input
                          type="number"
                          value={selectedOverlay.theta}
                          onChange={(e) => updateSelectedOverlay((o) => ({ ...o, theta: Number(e.target.value) }))}
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                      <label className="block text-xs font-medium text-ink-muted">
                        Scale
                        <input
                          type="number"
                          step={0.025}
                          value={selectedOverlay.scale}
                          onChange={(e) => updateSelectedOverlay((o) => ({ ...o, scale: Number(e.target.value) }))}
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => rotateSelected(-5)} className={btnSecondary}>
                        -5°
                      </button>
                      <button type="button" onClick={() => rotateSelected(5)} className={btnSecondary}>
                        +5°
                      </button>
                      <button type="button" onClick={() => scaleSelected(-0.05)} className={btnSecondary}>
                        Scale -
                      </button>
                      <button type="button" onClick={() => scaleSelected(0.05)} className={btnSecondary}>
                        Scale +
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => nudgeSelected(-5, 0)} className={btnSecondary}>
                        ←
                      </button>
                      <button type="button" onClick={() => nudgeSelected(5, 0)} className={btnSecondary}>
                        →
                      </button>
                      <button type="button" onClick={() => nudgeSelected(0, 5)} className={btnSecondary}>
                        ↑
                      </button>
                      <button type="button" onClick={() => nudgeSelected(0, -5)} className={btnSecondary}>
                        ↓
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 border-t border-slate-200 pt-4">
          <button type="button" onClick={save} disabled={saving} className={btnPrimary}>
            {saving ? "Saving…" : "Save Calibration"}
          </button>
          <button type="button" onClick={load} className={btnSecondary}>
            Load
          </button>
          <button type="button" onClick={reset} className={btnSecondary}>
            Reset
          </button>
        </div>
      </div>
    </HasPermission>
  );
}

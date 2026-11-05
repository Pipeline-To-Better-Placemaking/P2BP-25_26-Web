import { PageHeader } from "../../../components/PageHeader";
import { SECONDARY_BUTTON } from "../../../components/buttonStyles";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { HasPermission } from "../../../auth/HasPermission";
import { Permissions } from "../../../lib/permissions";
import * as deviceApi from "../../../services/deviceApi";
import * as boardLibraryApi from "../../../services/boardLibraryApi";
import * as homographyApi from "../../../services/homographyApi";
import * as floorplanLibraryApi from "../../../services/floorplanLibraryApi";
import type { CameraInfo, DeviceDto, IntrinsicsCalibrationState } from "../../../lib/deviceTypes";
import type { BoardLibraryItem } from "../../../lib/boardLibraryTypes";
import type { GlobalHomographySetDto } from "../../../lib/homographyTypes";
import type { FloorplanLibraryItemDto } from "../../../lib/floorplanTypes";
import { CameraModal } from "./CameraModal";
import { DeviceModal } from "./DeviceModal";
import { BoardGenerateModal } from "./BoardGenerateModal";
import { BoardDetailModal } from "./BoardDetailModal";
import { VisionTutorial } from "./VisionTutorial";

/**
 * Ported from the Angular views/projects/selected/vision/{vision.ts,vision.html}.
 * Central calibration dashboard for a project: cameras (intrinsics/homography/
 * ArUco-lock status), the user's board library, Jetson devices, a floorplan
 * library, and a launch point into the Puzzle workspace (BetterPlacemaking
 * .CLIENT.REACT/src/pages/projects/calibration/Puzzle.tsx, ported separately -
 * see RequirePuzzleReady.tsx for its route guard).
 *
 * Everything here talks to already-ported backend resources (device,
 * board-library, floorplan-library, homography/workspace + snapshot-url).
 * Nothing in this page depends on Rplidar or the Visualizer (3D mesh/point
 * cloud) pipeline - the old Angular vision.ts/.html never reference either.
 */

const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;
const POLL_INTERVAL_MS = 30_000;
const HEARTBEAT_GRACE_MULTIPLIER = 6;
const MIN_ONLINE_WINDOW_MS = 2 * 60 * 1000;
const TOUR_KEY = "vision-tutorial-seen";

interface CameraEntry {
  device: DeviceDto;
  mac: string;
  info: CameraInfo;
  intrinsics: IntrinsicsCalibrationState | null;
  nickname: string;
  index: number;
}

function buildCameraKey(deviceId: string, mac: string): string {
  return `${deviceId.trim().toLowerCase()}|${mac.trim().toLowerCase()}`;
}

function computeAllCameras(devices: DeviceDto[]): CameraEntry[] {
  const allEntries: { device: DeviceDto; mac: string; info: CameraInfo }[] = [];
  for (const device of devices) {
    for (const [mac, info] of Object.entries(device.HealthReport?.Cameras ?? {})) {
      if (info) allEntries.push({ device, mac, info });
    }
  }

  const byMac = new Map<string, { device: DeviceDto; mac: string; info: CameraInfo }>();
  for (const entry of allEntries) {
    const existing = byMac.get(entry.mac);
    if (!existing || (!existing.info.Enabled && entry.info.Enabled)) {
      byMac.set(entry.mac, entry);
    }
  }

  let index = 0;
  return Array.from(byMac.values()).map(({ device, mac, info }) => {
    const intrinsicsMap = device.HealthReport?.IntrinsicsCalibration ?? {};
    return {
      device,
      mac,
      info,
      intrinsics: intrinsicsMap[mac] ?? null,
      nickname: localStorage.getItem(`cam-nickname-${mac}`) ?? "",
      index: ++index,
    };
  });
}

function getHealthReportDate(device: DeviceDto): Date | null {
  const ts = device.HealthReport?.Timestamp;
  if (!ts) return null;
  const ms = ts < 1_000_000_000_000 ? ts * 1000 : ts;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isHeartbeatFresh(device: DeviceDto): boolean {
  const date = getHealthReportDate(device);
  if (!date) return false;

  const configuredInterval = Number(device.Config?.HeartbeatInterval);
  const heartbeatIntervalSeconds =
    Number.isFinite(configuredInterval) && configuredInterval > 0 ? configuredInterval : DEFAULT_HEARTBEAT_INTERVAL_SECONDS;

  const maxAgeMs = Math.max(MIN_ONLINE_WINDOW_MS, heartbeatIntervalSeconds * 1000 * HEARTBEAT_GRACE_MULTIPLIER);
  return Date.now() - date.getTime() <= maxAgeMs;
}

function formatRelative(date: Date | null): string {
  if (!date) return "Never";
  if (Number.isNaN(date.getTime())) return "Unknown";
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function getArucoStatus(device: DeviceDto): string {
  return (device.Config?.ArucoLock?.Status ?? "unlocked").trim().toLowerCase();
}

function boardPreviewUrl(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg ?? "")}`;
}

type Severity = "success" | "info" | "danger" | "warn" | "secondary";

function StatusTag({ label, severity, title }: { label: string; severity: Severity; title?: string }) {
  const classes: Record<Severity, string> = {
    success: "bg-emerald-100 text-emerald-800",
    info: "bg-blue-100 text-blue-800",
    danger: "bg-red-100 text-red-800",
    warn: "bg-amber-100 text-amber-800",
    secondary: "bg-slate-200 text-ink-muted",
  };
  return (
    <span title={title} className={`flex-1 cursor-default justify-center rounded px-1.5 py-0.5 text-center text-xs font-semibold ${classes[severity]}`}>
      {label}
    </span>
  );
}

function StatCard({
  label,
  value,
  valueClassName,
  suffix,
  helpText,
  children,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  suffix?: string;
  helpText: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="h-full bp-card p-6">
      <div className="text-sm text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">
        <span className={valueClassName}>{value}</span>
        {suffix && <span className="text-sm font-normal text-ink-muted"> {suffix}</span>}
      </div>
      <div className="mt-1 text-xs text-ink-muted">{helpText}</div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Panel({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="bp-card p-6">
      <h3 className="mb-3 text-xl font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

export function Vision() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();

  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [loading, setLoading] = useState(true);

  const [boardLibrary, setBoardLibrary] = useState<BoardLibraryItem[]>([]);
  const [boardLibraryLoading, setBoardLibraryLoading] = useState(false);
  const [boardLibraryError, setBoardLibraryError] = useState(false);

  const [homographyCameraKeys, setHomographyCameraKeys] = useState<Set<string>>(new Set());
  const [globalHomographies, setGlobalHomographies] = useState<GlobalHomographySetDto | null>(null);
  const [puzzlePiecesTotal, setPuzzlePiecesTotal] = useState(0);
  const [puzzlePiecesReady, setPuzzlePiecesReady] = useState(0);
  const [puzzleReady, setPuzzleReady] = useState(false);

  const [floorplans, setFloorplans] = useState<FloorplanLibraryItemDto[]>([]);
  const [floorplansLoading, setFloorplansLoading] = useState(false);
  const [uploadingFloorplan, setUploadingFloorplan] = useState(false);
  const [selectedFloorplanId, setSelectedFloorplanId] = useState<string | null>(null);

  const [showTutorial, setShowTutorial] = useState(false);

  const [cameraModalTarget, setCameraModalTarget] = useState<CameraEntry | null>(null);
  const [deviceModalTarget, setDeviceModalTarget] = useState<DeviceDto | null>(null);
  const [boardGenerateOpen, setBoardGenerateOpen] = useState(false);
  const [boardDetailTarget, setBoardDetailTarget] = useState<BoardLibraryItem | null>(null);

  const floorplanInputRef = useRef<HTMLInputElement | null>(null);

  const allCameras = useMemo(() => computeAllCameras(devices), [devices]);

  const statIntrinsicsDone = allCameras.filter((c) => c.intrinsics?.Status === "done").length;
  const statCamerasReady = statIntrinsicsDone;
  const statHomographiesDone = allCameras.filter((cam) => cam.device?.Id && homographyCameraKeys.has(buildCameraKey(cam.device.Id, cam.mac))).length;
  const statArUcoLocked = devices.some((d) => getArucoStatus(d) === "locked");
  const camsNeedingAttention = allCameras.filter((c) => c.intrinsics?.Status !== "done").length;
  const hasLocalHomographies = allCameras.length > 0 && statHomographiesDone === allCameras.length;

  const firstCamera = allCameras[0] ?? null;
  const firstDevice = devices[0] ?? null;
  const firstCameraNeedingIntrinsics = allCameras.find((c) => c.intrinsics?.Status !== "done") ?? firstCamera;
  const firstCameraReadyForHomography = allCameras.find((c) => c.intrinsics?.Status === "done") ?? null;

  const recommendedAction = loading
    ? null
    : allCameras.length === 0
      ? "No cameras found. Ensure devices are online and reporting a health report."
      : statIntrinsicsDone < allCameras.length
        ? `${allCameras.length - statIntrinsicsDone} camera${allCameras.length - statIntrinsicsDone > 1 ? "s" : ""} still need intrinsics calibration. Click a camera card to run calibration.`
        : !statArUcoLocked
          ? "Intrinsics complete. Run ArUco lock calibration on each device to finalize setup."
          : null;

  const homographyActionLabel = firstCameraReadyForHomography ? "Open Camera" : "Needs Intrinsics";
  const homographyHelpText = firstCameraReadyForHomography
    ? "Use a camera with intrinsics complete to trigger the ChArUco homography scan."
    : "Finish at least one camera intrinsics calibration before running homography.";

  const selectedFloorplan = floorplans.find((f) => f.Id === selectedFloorplanId) ?? null;

  const globalSavedAt = (() => {
    if (!globalHomographies?.SavedAt) return null;
    const date = new Date(globalHomographies.SavedAt);
    if (Number.isNaN(date.getTime())) return null;
    return formatRelative(date);
  })();

  const hasHomography = useCallback(
    (cam: CameraEntry) => (cam.device?.Id ? homographyCameraKeys.has(buildCameraKey(cam.device.Id, cam.mac)) : false),
    [homographyCameraKeys],
  );

  function cameraStatusBorderClass(cam: CameraEntry): string {
    if (cam.intrinsics?.Status === "done") return "border-emerald-500";
    if (cam.intrinsics?.Status === "collecting") return "border-amber-500";
    return "border-red-500";
  }

  function intrinsicsSeverity(cam: CameraEntry): Severity {
    if (cam.intrinsics?.Status === "done") return "success";
    if (cam.intrinsics?.Status === "collecting") return "info";
    return "secondary";
  }

  function homographySeverity(cam: CameraEntry): Severity {
    return hasHomography(cam) ? "success" : "secondary";
  }

  function arucoSeverity(cam: CameraEntry): Severity {
    const status = getArucoStatus(cam.device);
    if (status === "locked") return "success";
    if (status === "scanning") return "warn";
    if (status === "failed" || status === "error") return "danger";
    return "secondary";
  }

  const loadDevices = useCallback(async () => {
    if (!projectId) return;
    try {
      const all = await deviceApi.getDevicesByProject(projectId);
      setDevices(all);
      setLoading(false);
      await checkLocalHomographies(all);
    } catch {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const checkLocalHomographies = useCallback(
    async (currentDevices: DeviceDto[]) => {
      if (currentDevices.length === 0) {
        setHomographyCameraKeys(new Set());
        setPuzzlePiecesTotal(0);
        setPuzzlePiecesReady(0);
        setPuzzleReady(false);
        setGlobalHomographies(null);
        return;
      }

      try {
        const workspace = await homographyApi.getPuzzleWorkspace(projectId);
        const total = workspace.PuzzlePieces.length;
        const ready = workspace.PuzzlePieces.filter((p) => p.Status === "ready").length;
        setPuzzlePiecesTotal(total);
        setPuzzlePiecesReady(ready);
        setPuzzleReady(total > 0 && total === ready);
        setHomographyCameraKeys(
          new Set(
            (workspace.LocalHomographies ?? [])
              .filter((h) => !!h.DeviceId && !!h.CameraMac)
              .map((h) => buildCameraKey(h.DeviceId, h.CameraMac)),
          ),
        );
        setGlobalHomographies(workspace.GlobalHomographies ?? null);
      } catch {
        setPuzzlePiecesTotal(0);
        setPuzzlePiecesReady(0);
        setPuzzleReady(false);
        setHomographyCameraKeys(new Set());
        setGlobalHomographies(null);
      }
    },
    [projectId],
  );

  const loadBoardLibrary = useCallback(async () => {
    setBoardLibraryLoading(true);
    setBoardLibraryError(false);
    try {
      const items = await boardLibraryApi.getLibrary();
      setBoardLibrary(items);
    } catch {
      setBoardLibrary([]);
      setBoardLibraryError(true);
    } finally {
      setBoardLibraryLoading(false);
    }
  }, []);

  const loadFloorplans = useCallback(async () => {
    if (!projectId) return;
    setFloorplansLoading(true);
    try {
      const items = await floorplanLibraryApi.getFloorplanLibrary(projectId);
      setFloorplans(items);
      setSelectedFloorplanId((current) => {
        if (!current && items.length > 0) return items[0].Id;
        if (current && !items.find((f) => f.Id === current)) return items[0]?.Id ?? null;
        return current;
      });
    } catch {
      // keep prior list on failure
    } finally {
      setFloorplansLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadDevices();
    const interval = setInterval(() => void loadDevices(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadDevices]);

  useEffect(() => {
    void loadBoardLibrary();
  }, [loadBoardLibrary]);

  useEffect(() => {
    void loadFloorplans();
  }, [loadFloorplans]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!localStorage.getItem(TOUR_KEY)) setShowTutorial(true);
    }, 500);
    return () => clearTimeout(t);
  }, []);

  function onTutorialDone() {
    setShowTutorial(false);
    localStorage.setItem(TOUR_KEY, "1");
  }

  async function onFloorplanFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !projectId) return;

    const nickname = file.name.replace(/\.[^.]+$/, "");
    setUploadingFloorplan(true);
    try {
      await floorplanLibraryApi.uploadFloorplan(file, nickname, projectId);
      await loadFloorplans();
    } finally {
      setUploadingFloorplan(false);
    }
  }

  async function handleDeleteFloorplan(id: string) {
    await floorplanLibraryApi.deleteFloorplan(id);
    await loadFloorplans();
  }

  function openPuzzleWorkspace() {
    const params = new URLSearchParams();
    if (selectedFloorplan?.ImageDownloadUrl) params.set("floorplanUrl", selectedFloorplan.ImageDownloadUrl);
    if (selectedFloorplan?.Id) params.set("floorplanId", selectedFloorplan.Id);
    const query = params.toString();
    navigate(`/${projectId}/calibration/puzzle${query ? `?${query}` : ""}`);
  }

  return (
    <HasPermission permission={Permissions.Project.VisionRead} projectId={projectId}>
      <div className="w-full">
        <PageHeader
          title="Vision Calibration"
          subtitle="Calibrate cameras, compute homographies, and assemble the top-down map."
          actions={
            <button type="button" onClick={() => setShowTutorial(true)} className={SECONDARY_BUTTON}>
              <i className="pi pi-question-circle text-xs" />
              Take Tour
            </button>
          }
        />
      <div className="flex w-full flex-col gap-6">
        {recommendedAction && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{recommendedAction}</p>}

        {/* Stat bar */}
        <div id="tutorial-stat-bar" className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            label="Cameras Ready"
            value={`${statCamerasReady}`}
            suffix={`/ ${allCameras.length}`}
            valueClassName={
              statCamerasReady === allCameras.length && allCameras.length > 0
                ? "text-emerald-600"
                : statCamerasReady > 0
                  ? "text-amber-600"
                  : "text-red-600"
            }
            helpText="Fully calibrated"
          >
            <HasPermission permission={Permissions.Project.DevicesRead} projectId={projectId}>
              <button
                type="button"
                disabled={!firstCamera}
                onClick={() => (firstCameraNeedingIntrinsics ?? firstCamera) && setCameraModalTarget(firstCameraNeedingIntrinsics ?? firstCamera)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
                  camsNeedingAttention > 0 ? "bg-red-600 hover:bg-red-500" : "bg-brand-600 hover:bg-brand-600/85"
                }`}
              >
                {camsNeedingAttention > 0 ? `Calibrate (${camsNeedingAttention})` : "Review Cameras"}
              </button>
            </HasPermission>
          </StatCard>

          <StatCard
            label="Intrinsics Done"
            value={`${statIntrinsicsDone}`}
            suffix={`/ ${allCameras.length}`}
            valueClassName={
              statIntrinsicsDone === allCameras.length && allCameras.length > 0
                ? "text-emerald-600"
                : statIntrinsicsDone > 0
                  ? "text-amber-600"
                  : "text-red-600"
            }
            helpText="Lens distortion calibrated"
          >
            <HasPermission permission={Permissions.Project.DevicesManage} projectId={projectId}>
              <button
                type="button"
                disabled={!firstCameraNeedingIntrinsics}
                onClick={() => firstCameraNeedingIntrinsics && setCameraModalTarget(firstCameraNeedingIntrinsics)}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-50"
              >
                Run Intrinsics
              </button>
            </HasPermission>
          </StatCard>

          <StatCard
            label="Homographies"
            value={`${statHomographiesDone}`}
            suffix={`/ ${allCameras.length}`}
            valueClassName={
              statHomographiesDone === allCameras.length && allCameras.length > 0
                ? "text-emerald-600"
                : statHomographiesDone > 0
                  ? "text-amber-600"
                  : "text-red-600"
            }
            helpText="Pixel → world mapping"
          >
            <HasPermission permission={Permissions.Project.DevicesManage} projectId={projectId}>
              <button
                type="button"
                disabled={!firstCameraReadyForHomography}
                onClick={() => firstCameraReadyForHomography && setCameraModalTarget(firstCameraReadyForHomography)}
                title={homographyHelpText}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50 disabled:opacity-50"
              >
                {homographyActionLabel}
              </button>
            </HasPermission>
          </StatCard>

          <StatCard
            label="ArUco Lock"
            value={statArUcoLocked ? "Locked" : "Unlocked"}
            valueClassName={statArUcoLocked ? "text-emerald-600" : "text-red-600"}
            helpText="Origin established"
          >
            <HasPermission permission={Permissions.Project.DevicesManage} projectId={projectId}>
              <button
                type="button"
                disabled={!firstDevice || !hasLocalHomographies}
                onClick={() => firstDevice && setDeviceModalTarget(firstDevice)}
                title={!hasLocalHomographies ? "Run a ChArUco homography scan on all cameras first" : ""}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-50"
              >
                Open ArUco Lock
              </button>
            </HasPermission>
          </StatCard>
        </div>

        <div className="flex flex-col gap-6 xl:grid xl:grid-cols-2 xl:items-start">
          <div className="flex min-w-0 flex-col gap-6">
            {/* Cameras panel */}
            <Panel id="tutorial-cameras-panel" title={camsNeedingAttention > 0 ? `Cameras (${camsNeedingAttention} need attention)` : "Cameras"}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-ink-muted">Discover cameras and jump straight into per-camera calibration.</div>
                <HasPermission permission={Permissions.Project.DevicesRead} projectId={projectId}>
                  <button
                    type="button"
                    disabled={!firstCamera}
                    onClick={() => (firstCameraNeedingIntrinsics ?? firstCamera) && setCameraModalTarget(firstCameraNeedingIntrinsics ?? firstCamera)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50 disabled:opacity-50"
                  >
                    Open Camera
                  </button>
                </HasPermission>
              </div>

              {loading && <div className="py-4 text-center text-sm text-ink-muted">Loading cameras...</div>}
              {!loading && allCameras.length === 0 && (
                <div className="py-4 text-center text-sm text-ink-muted">No cameras reported. Ensure devices are online.</div>
              )}
              {!loading && allCameras.length > 0 && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
                  {allCameras.map((cam) => (
                    <div
                      key={cam.mac}
                      onClick={() => setCameraModalTarget(cam)}
                      className={`cursor-pointer rounded-lg border-l-4 bg-slate-50 p-3 transition-opacity hover:opacity-90 ${cameraStatusBorderClass(cam)}`}
                    >
                      <div className="mb-2 flex items-start justify-between">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-ink">{cam.nickname || `Camera ${cam.index}`}</div>
                          <div className="truncate font-mono text-xs text-ink-muted">{cam.mac}</div>
                        </div>
                        <span className={`ml-1 mt-1 h-2 w-2 flex-shrink-0 rounded-full ${cam.info.Enabled ? "bg-emerald-500" : "bg-red-500"}`} />
                      </div>
                      <div className="mb-2 text-xs text-ink-muted">{cam.info.Ip}</div>
                      <div className="flex gap-1">
                        <StatusTag label="I" severity={intrinsicsSeverity(cam)} title="Intrinsics" />
                        <StatusTag label="H" severity={homographySeverity(cam)} title={hasHomography(cam) ? "Homography ready" : "Homography missing"} />
                        <StatusTag label="A" severity={arucoSeverity(cam)} title="ArUco lock" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* Board Library */}
            <Panel id="tutorial-board-library" title="Board Library">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-ink-muted">Saved boards are user-scoped and reusable across projects.</div>
                  <HasPermission permission={Permissions.Project.Update} projectId={projectId}>
                    <button
                      type="button"
                      onClick={() => setBoardGenerateOpen(true)}
                      title="Generate a ChArUco or ArUco board for printing"
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50"
                    >
                      + Generate New Board
                    </button>
                  </HasPermission>
                </div>

                {boardLibraryLoading && <div className="py-3 text-center text-sm text-ink-muted">Loading board library...</div>}
                {boardLibraryError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">Failed to load board library.</p>}
                {!boardLibraryLoading && !boardLibraryError && boardLibrary.length === 0 && (
                  <div className="py-4 text-center text-sm text-ink-muted">No saved boards yet. Generate one and click Save to Library.</div>
                )}
                {!boardLibraryLoading && boardLibrary.length > 0 && (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {boardLibrary.map((board) => (
                      <div
                        key={board.Id}
                        onClick={() => setBoardDetailTarget(board)}
                        className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 p-3 transition-opacity hover:opacity-90"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="truncate text-sm font-semibold text-ink">{board.Nickname || "Untitled Board"}</div>
                          <StatusTag label={board.Type.toUpperCase()} severity={board.Type === "charuco" ? "info" : "secondary"} />
                        </div>
                        <div className="mb-2 text-xs text-ink-muted">{board.Dictionary}</div>
                        {board.Type === "charuco" && (
                          <div className="mb-2 text-xs text-ink-muted">
                            {board.Cols} x {board.Rows} grid • {board.SquareSize} {board.Units} square
                          </div>
                        )}
                        {board.Type === "aruco" && (
                          <div className="mb-2 text-xs text-ink-muted">
                            Marker #{board.MarkerId ?? 0} • {board.MarkerSize} {board.Units}
                          </div>
                        )}
                        <div className="flex h-28 items-center justify-center overflow-hidden rounded border border-slate-200 bg-white p-2">
                          <img src={boardPreviewUrl(board.PreviewSvg)} alt="Board preview" className="h-auto max-h-full w-auto max-w-full object-contain" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Panel>

            {/* Floorplan Library */}
            <Panel id="tutorial-floorplan-library" title="Floorplan Library">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-ink-muted">Click a floorplan to select it for the puzzle workspace.</div>
                  <HasPermission permission={Permissions.Project.Update} projectId={projectId}>
                    <label className="cursor-pointer">
                      <span className="inline-block rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50">
                        {uploadingFloorplan ? "Uploading…" : "Upload Floorplan"}
                      </span>
                      <input ref={floorplanInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onFloorplanFileSelected(e)} />
                    </label>
                  </HasPermission>
                </div>

                {floorplansLoading && <div className="py-3 text-center text-sm text-ink-muted">Loading floorplans...</div>}
                {!floorplansLoading && floorplans.length === 0 && (
                  <div className="py-4 text-center text-sm text-ink-muted">No floorplans uploaded yet.</div>
                )}
                {!floorplansLoading && floorplans.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                    {floorplans.map((fp) => {
                      const selected = fp.Id === selectedFloorplanId;
                      return (
                        <div
                          key={fp.Id}
                          onClick={() => setSelectedFloorplanId(fp.Id)}
                          className={`flex cursor-pointer flex-col overflow-hidden rounded-lg transition-all ${
                            selected ? "bg-brand-50 ring-2 ring-brand-500" : "border border-slate-200 bg-slate-50"
                          }`}
                        >
                          <div className="relative flex h-24 items-center justify-center overflow-hidden bg-slate-200">
                            {fp.ImageDownloadUrl ? (
                              <img src={fp.ImageDownloadUrl} alt={fp.Nickname} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-2xl opacity-30">🖼</span>
                            )}
                            {selected && (
                              <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-xs text-white">✓</div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 p-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-semibold text-ink">{fp.Nickname}</div>
                              <div className="text-xs text-ink-muted">
                                {fp.ImageWidth} × {fp.ImageHeight}
                              </div>
                            </div>
                            <HasPermission permission={Permissions.Project.Update} projectId={projectId}>
                              <button
                                type="button"
                                title="Delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDeleteFloorplan(fp.Id);
                                }}
                                className="rounded p-1 text-red-600 hover:bg-red-50"
                              >
                                🗑
                              </button>
                            </HasPermission>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Panel>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            {/* Devices panel */}
            <Panel id="tutorial-devices-panel" title="Devices">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-ink-muted">Check Jetson heartbeat, health, and device-level calibration actions.</div>
                <HasPermission permission={Permissions.Project.DevicesRead} projectId={projectId}>
                  <button
                    type="button"
                    disabled={!firstDevice}
                    onClick={() => firstDevice && setDeviceModalTarget(firstDevice)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50 disabled:opacity-50"
                  >
                    Open Device
                  </button>
                </HasPermission>
              </div>

              {loading && <div className="py-4 text-center text-sm text-ink-muted">Loading devices...</div>}
              {!loading && devices.length === 0 && (
                <div className="py-4 text-center text-sm text-ink-muted">No devices assigned to this project.</div>
              )}
              {!loading && devices.length > 0 && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {devices.map((device) => {
                    const online = isHeartbeatFresh(device);
                    const camerasForDevice = Object.keys(device.HealthReport?.Cameras ?? {}).length;
                    return (
                      <div
                        key={device.Id}
                        onClick={() => setDeviceModalTarget(device)}
                        className={`cursor-pointer rounded-lg border-l-4 bg-slate-50 p-3 transition-opacity hover:opacity-90 ${
                          online ? "border-emerald-500" : "border-red-500"
                        }`}
                      >
                        <div className="mb-2 flex items-start justify-between">
                          <div className="text-sm font-semibold text-ink">{device.Name || "Unnamed Device"}</div>
                          <StatusTag label={online ? "Online" : "Offline"} severity={online ? "success" : "danger"} />
                        </div>
                        <div className="mb-3 text-xs text-ink-muted">Last seen: {formatRelative(getHealthReportDate(device))}</div>
                        <div className="flex gap-4 text-xs text-ink-muted">
                          <span>
                            <span className="font-semibold text-ink">{device.HealthReport?.System?.Gpu?.UtilizationPct ?? "—"}</span>% GPU
                          </span>
                          <span>
                            <span className="font-semibold text-ink">{device.HealthReport?.System?.Memory?.UsedMb ?? "—"}</span> MB RAM
                          </span>
                          <span>
                            <span className="font-semibold text-ink">
                              {(device.HealthReport?.System?.CpuTemperatureC ?? -1) >= 0 ? device.HealthReport?.System?.CpuTemperatureC : "—"}
                            </span>
                            °C CPU
                          </span>
                          <span>
                            <span className="font-semibold text-ink">{camerasForDevice}</span> cam{camerasForDevice !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            {/* Top-Down Map */}
            <Panel id="tutorial-topdown-map" title="Top-Down Map View">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-ink">Puzzle Assembly Workspace</div>
                  <div className="text-sm text-ink-muted">Align BEV camera layers on the floorplan to produce global homographies.</div>
                  {selectedFloorplan && <div className="mt-1 text-xs text-ink-muted">📍 {selectedFloorplan.Nickname}</div>}
                  {!selectedFloorplan && floorplans.length === 0 && (
                    <div className="mt-1 text-xs text-orange-600">Upload a floorplan below to enable the puzzle.</div>
                  )}
                </div>
                <HasPermission permission={Permissions.Project.VisionRead} projectId={projectId}>
                  <button
                    type="button"
                    disabled={!puzzleReady || !selectedFloorplan}
                    onClick={openPuzzleWorkspace}
                    title={!puzzleReady ? "All camera BEV images must be ready before opening the puzzle" : !selectedFloorplan ? "Select a floorplan from the Floorplan Library below" : ""}
                    className="flex-shrink-0 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-50"
                  >
                    Open Puzzle
                  </button>
                </HasPermission>
              </div>

              {globalHomographies && (
                <div className="mt-4 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="flex-shrink-0 text-lg text-emerald-600">✓</span>
                  <div className="text-sm">
                    <span className="font-semibold text-ink">Puzzle saved</span>
                    <span className="ml-2 text-ink-muted">{globalSavedAt}</span>
                    <span className="ml-2 text-ink-muted">
                      · {globalHomographies.Placements.length} camera{globalHomographies.Placements.length !== 1 ? "s" : ""} placed
                    </span>
                  </div>
                </div>
              )}

              {puzzlePiecesTotal === 0 && (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4">
                  <span className="mt-0.5 flex-shrink-0 text-xl text-red-500">✕</span>
                  <div>
                    <div className="text-sm font-semibold text-red-700">No camera scans found</div>
                    <div className="mt-1 text-xs text-red-600">
                      Run a ChArUco homography scan on each camera from the camera modal above. All cameras must submit a BEV image before the puzzle can open.
                    </div>
                  </div>
                </div>
              )}

              {puzzlePiecesTotal > 0 && !puzzleReady && (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <span className="mt-0.5 flex-shrink-0 text-xl text-amber-500">⚠</span>
                  <div>
                    <div className="text-sm font-semibold text-amber-700">
                      {puzzlePiecesReady} / {puzzlePiecesTotal} cameras ready
                    </div>
                    <div className="mt-1 text-xs text-amber-600">
                      Some cameras are still missing BEV images. Run a ChArUco scan on the remaining cameras to unlock the puzzle workspace.
                    </div>
                  </div>
                </div>
              )}

              {puzzleReady && (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
                  <span className="mt-0.5 flex-shrink-0 text-xl text-emerald-500">✓</span>
                  <div>
                    <div className="text-sm font-semibold text-emerald-700">All {puzzlePiecesTotal} cameras ready</div>
                    <div className="mt-1 text-xs text-emerald-600">All BEV images are generated. Open the puzzle workspace to align camera layers on the floorplan.</div>
                  </div>
                </div>
              )}
            </Panel>
          </div>
        </div>

        {showTutorial && <VisionTutorial onDone={onTutorialDone} />}
      </div>
      </div>

      {cameraModalTarget && (
        <CameraModal
          device={cameraModalTarget.device}
          mac={cameraModalTarget.mac}
          camInfo={cameraModalTarget.info}
          intrinsics={cameraModalTarget.intrinsics}
          allDevices={devices}
          homographyReady={hasHomography(cameraModalTarget)}
          onClose={() => {
            setCameraModalTarget(null);
            void loadDevices();
          }}
        />
      )}

      {deviceModalTarget && (
        <DeviceModal
          device={deviceModalTarget}
          allDevices={devices}
          onClose={() => {
            setDeviceModalTarget(null);
            void loadDevices();
          }}
        />
      )}

      {boardGenerateOpen && (
        <BoardGenerateModal
          projectId={projectId}
          onClose={() => setBoardGenerateOpen(false)}
          onSaved={() => {
            setBoardGenerateOpen(false);
            void loadBoardLibrary();
          }}
        />
      )}

      {boardDetailTarget && (
        <BoardDetailModal
          board={boardDetailTarget}
          projectId={projectId}
          onClose={() => setBoardDetailTarget(null)}
          onUpdated={() => void loadBoardLibrary()}
          onDeleted={() => void loadBoardLibrary()}
        />
      )}
    </HasPermission>
  );
}

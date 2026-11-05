import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../../components/Modal";
import { HasPermission } from "../../../auth/HasPermission";
import { Permissions } from "../../../lib/permissions";
import * as deviceApi from "../../../services/deviceApi";
import * as boardLibraryApi from "../../../services/boardLibraryApi";
import * as homographyApi from "../../../services/homographyApi";
import type { CameraInfo, DeviceDto, IntrinsicsCalibrationState } from "../../../lib/deviceTypes";
import type { BoardLibraryItem } from "../../../lib/boardLibraryTypes";

/**
 * Ported from the Angular camera-modal/{camera-modal.ts,.html}.
 *
 * NOTE: despite the "camera" name this is NOT a getUserMedia/browser-webcam
 * feature (the Angular source has no getUserMedia call either) - it is a
 * calibration control panel for one physical camera attached to a remote
 * Jetson device. It polls the device's health report (fast while intrinsics
 * calibration is actively collecting, slower otherwise - same cadence as the
 * Angular version's pollRate$/switchMap), shows the last homography snapshot
 * image the Jetson uploaded, and toggles calibration flags on the device's
 * Config via the same PUT /api/device/project/:projectId/:id used elsewhere.
 */

const CALIBRATING_POLL_MS = 2_000;
const MIN_POLL_INTERVAL_MS = 5_000;

type Severity = "success" | "info" | "danger" | "warn" | "secondary";

function Tag({ label, severity }: { label: string; severity: Severity }) {
  const classes: Record<Severity, string> = {
    success: "bg-emerald-100 text-emerald-800",
    info: "bg-blue-100 text-blue-800",
    danger: "bg-red-100 text-red-800",
    warn: "bg-amber-100 text-amber-800",
    secondary: "bg-slate-100 text-ink",
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${classes[severity]}`}>{label}</span>;
}

interface CameraModalProps {
  device: DeviceDto;
  mac: string;
  camInfo: CameraInfo | null;
  intrinsics: IntrinsicsCalibrationState | null;
  allDevices: DeviceDto[];
  homographyReady: boolean;
  onClose: () => void;
}

export function CameraModal({
  device: initialDevice,
  mac,
  camInfo,
  intrinsics: initialIntrinsics,
  allDevices,
  homographyReady,
  onClose,
}: CameraModalProps) {
  const deviceId = initialDevice.Id;
  const deviceProjectId = initialDevice.ProjectId;
  const normalPollMs = Math.max(MIN_POLL_INTERVAL_MS, (initialDevice.Config?.HeartbeatInterval ?? 30) * 1000);

  const [device, setDevice] = useState(initialDevice);
  const [intrinsics, setIntrinsics] = useState(initialIntrinsics);
  const [pollMs, setPollMs] = useState(initialIntrinsics?.Status === "collecting" ? CALIBRATING_POLL_MS : normalPollMs);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [nickname, setNickname] = useState(() => localStorage.getItem(`cam-nickname-${mac}`) ?? "");
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");

  const [intrinsicsActionMessage, setIntrinsicsActionMessage] = useState<string | null>(null);
  const [intrinsicsError, setIntrinsicsError] = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);

  const [homographyLoading, setHomographyLoading] = useState(false);
  const [homographyTriggered, setHomographyTriggered] = useState(false);
  const [homographyError, setHomographyError] = useState(false);

  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);

  const [boardLibrary, setBoardLibrary] = useState<BoardLibraryItem[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");

  const charucoBoards = useMemo(() => boardLibrary.filter((b) => b.Type === "charuco"), [boardLibrary]);
  const selectedBoard = charucoBoards.find((b) => b.Id === selectedBoardId) ?? null;

  useEffect(() => {
    boardLibraryApi
      .getLibrary()
      .then(setBoardLibrary)
      .catch(() => setBoardLibrary([]));
  }, []);

  useEffect(() => {
    if (!deviceId || !mac) {
      setSnapshotLoading(false);
      return;
    }
    homographyApi
      .getSnapshotUrl(deviceId, mac)
      .then((url) => setSnapshotUrl(url))
      .finally(() => setSnapshotLoading(false));
  }, [deviceId, mac]);

  // Poll the device's health report - fast while intrinsics is actively collecting, slower
  // otherwise. Mirrors the Angular pollRate$ BehaviorSubject + switchMap(interval) pattern:
  // whenever pollMs changes, the old interval is torn down and a new one starts with an
  // immediate fetch.
  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;

    async function fetchOnce() {
      try {
        const updated = await deviceApi.getDevice(deviceProjectId ?? "", deviceId);
        if (cancelled) return;
        setDevice(updated);
        const nextIntrinsics = updated.HealthReport?.IntrinsicsCalibration?.[mac] ?? null;
        setIntrinsics(nextIntrinsics);
        setLastUpdated(new Date());

        const shouldPollFast = updated.Config?.Intrinsics?.BeginCalibration === true || nextIntrinsics?.Status === "collecting";
        const nextMs = shouldPollFast ? CALIBRATING_POLL_MS : normalPollMs;
        setPollMs((current) => (current !== nextMs ? nextMs : current));
      } catch {
        // silently ignore - stale data is fine
      }
    }

    void fetchOnce();
    const id = setInterval(() => void fetchOnce(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, deviceId, mac, normalPollMs]);

  const resolution = Array.isArray(camInfo?.Resolution) && camInfo.Resolution.length >= 2 ? `${camInfo.Resolution[0]} × ${camInfo.Resolution[1]}` : "—";
  const coverageGrid = intrinsics?.CoverageGrid ?? [];
  const coverageGridCols = coverageGrid.length === 0 ? 0 : Math.ceil(Math.sqrt(coverageGrid.length));
  const coverageFilled = coverageGrid.filter((v) => !!v).length;

  const intrinsicsStatus = intrinsics?.Status ?? "none";
  const isIntrinsicsEnabled = device.Config?.Intrinsics?.BeginCalibration === true;
  const intrinsicsButtonLabel = isIntrinsicsEnabled ? "Stop" : intrinsicsStatus === "done" ? "Run Again" : "Run";
  const intrinsicsSeverity: Severity = intrinsicsStatus === "done" ? "success" : intrinsicsStatus === "collecting" ? "info" : "secondary";

  const hasSuggestion = !!(intrinsics?.SuggestedRegion || intrinsics?.SuggestedTilt);
  const suggestionText = [
    intrinsics?.SuggestedRegion ? `Move the board to the ${intrinsics.SuggestedRegion} of the camera frame.` : null,
    intrinsics?.SuggestedTilt ? `Suggested tilt: ${intrinsics.SuggestedTilt}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const canRunHomography = intrinsicsStatus === "done" && !!selectedBoard;
  const homographyStatusLabel = homographyReady ? "Ready" : homographyLoading || homographyTriggered ? "Scanning" : "Missing";
  const homographySeverity: Severity = homographyReady ? "success" : homographyLoading || homographyTriggered ? "info" : "secondary";
  const homographyStatusDetail = homographyReady
    ? "Local homography found for this camera."
    : homographyLoading || homographyTriggered
      ? "Homography scan in progress."
      : "No local homography found for this camera yet.";

  const arucoStatus = (device.Config?.ArucoLock?.Status ?? "unlocked").toLowerCase();
  const arucoStatusLabel = arucoStatus === "locked" ? "Locked" : arucoStatus === "scanning" ? "Scanning" : arucoStatus === "failed" || arucoStatus === "error" ? "Failed" : "Unlocked";
  const arucoSeverity: Severity = arucoStatus === "locked" ? "success" : arucoStatus === "scanning" ? "warn" : arucoStatus === "failed" || arucoStatus === "error" ? "danger" : "secondary";
  const arucoStatusDetail = arucoStatus === "locked"
    ? "Device origin is established."
    : arucoStatus === "scanning"
      ? "ArUco lock scan is in progress on this device."
      : arucoStatus === "failed" || arucoStatus === "error"
        ? "Last ArUco lock scan failed."
        : "Run from the device card to establish origin.";

  const lastUpdatedLabel = (() => {
    if (!lastUpdated) return "";
    const diffSec = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
    if (diffSec < 5) return "just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    return `${Math.floor(diffSec / 60)}m ago`;
  })();

  function startEditNickname() {
    setNicknameInput(nickname);
    setEditingNickname(true);
  }

  function saveNickname() {
    const trimmed = nicknameInput.trim();
    if (trimmed) {
      localStorage.setItem(`cam-nickname-${mac}`, trimmed);
      setNickname(trimmed);
    } else {
      localStorage.removeItem(`cam-nickname-${mac}`);
      setNickname("");
    }
    setEditingNickname(false);
  }

  async function toggleIntrinsics() {
    if (!device.Id) return;
    const nextEnabled = !isIntrinsicsEnabled;
    setTriggerLoading(true);
    setIntrinsicsError(false);
    setIntrinsicsActionMessage(null);

    const existingConfig = device.Config ?? { HeartbeatInterval: 30 };
    const board = selectedBoard;
    const updated: DeviceDto = {
      ...device,
      Config: {
        ...existingConfig,
        CharucoBoard:
          nextEnabled && board
            ? {
                ...existingConfig.CharucoBoard,
                BeginScanning: existingConfig.CharucoBoard?.BeginScanning ?? false,
                Board: {
                  SquaresX: board.Cols ?? 7,
                  SquaresY: board.Rows ?? 5,
                  SquareSize: board.SquareSizeMm ?? 40,
                  ArucoSize: board.MarkerSizeMm,
                  Dictionary: board.Dictionary,
                },
              }
            : (existingConfig.CharucoBoard ?? { BeginScanning: false }),
        Intrinsics: {
          ...existingConfig.Intrinsics,
          BeginCalibration: nextEnabled,
        },
      },
    };

    try {
      const saved = await deviceApi.updateDevice(device.Id, updated);
      setDevice(saved);
      setIntrinsics(saved.HealthReport?.IntrinsicsCalibration?.[mac] ?? intrinsics);
      setIntrinsicsActionMessage(
        nextEnabled
          ? "Intrinsics calibration enabled. It will remain enabled until calibration completes or you stop it."
          : "Intrinsics calibration disabled.",
      );
      setPollMs(nextEnabled ? CALIBRATING_POLL_MS : normalPollMs);
    } catch {
      setIntrinsicsError(true);
    } finally {
      setTriggerLoading(false);
    }
  }

  async function triggerHomography() {
    if (!selectedBoard || homographyLoading) return;
    setHomographyLoading(true);
    setHomographyError(false);

    const boardDetails = {
      SquaresX: selectedBoard.Cols ?? 7,
      SquaresY: selectedBoard.Rows ?? 5,
      SquareSize: selectedBoard.SquareSizeMm ?? 40,
      ArucoSize: selectedBoard.MarkerSizeMm,
      Dictionary: selectedBoard.Dictionary,
    };

    const targets = allDevices.filter((d) => d.Id && d.Config);
    if (targets.length === 0) {
      setHomographyLoading(false);
      return;
    }

    try {
      await Promise.all(
        targets.map((d) =>
          deviceApi.updateDevice(d.Id, {
            ...d,
            Config: {
              ...d.Config!,
              CharucoBoard: { ...d.Config!.CharucoBoard, BeginScanning: true, Board: boardDetails },
            },
          }),
        ),
      );
      setHomographyTriggered(true);
    } catch {
      setHomographyError(true);
    } finally {
      setHomographyLoading(false);
    }
  }

  return (
    <Modal title={nickname || `Camera ${mac.slice(-5)}`} onClose={onClose} widthClassName="max-w-xl">
      <div className="flex flex-col gap-4">
        {/* Camera identity */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-lg font-semibold text-ink">{nickname || `Camera ${mac.slice(-5)}`}</span>
              <Tag label={camInfo?.Enabled ? "Enabled" : "Disabled"} severity={camInfo?.Enabled ? "success" : "secondary"} />
            </div>
            <div className="mb-1 font-mono text-xs text-ink-muted">{mac}</div>
            <div className="text-xs text-ink-muted">
              {camInfo?.Ip} &nbsp;·&nbsp; {resolution}
            </div>
          </div>
          <div className="flex-shrink-0">
            <HasPermission permission={Permissions.Project.DevicesManage} projectId={device.ProjectId}>
              {!editingNickname && (
                <button
                  type="button"
                  onClick={startEditNickname}
                  title="Edit nickname"
                  className="rounded-md p-1.5 text-ink-muted hover:bg-slate-100"
                >
                  ✎
                </button>
              )}
            </HasPermission>
          </div>
        </div>

        {editingNickname && (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveNickname();
                if (e.key === "Escape") setEditingNickname(false);
              }}
              placeholder="Enter nickname..."
              className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-ink"
            />
            <button type="button" onClick={saveNickname} title="Save" className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50">
              ✓
            </button>
            <button
              type="button"
              onClick={() => setEditingNickname(false)}
              title="Cancel"
              className="rounded-md p-1.5 text-ink-muted hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
        )}

        {/* Calibration stat grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-slate-100 p-3">
            <div className="mb-1 text-xs text-ink-muted">Intrinsics</div>
            <Tag label={intrinsicsStatus === "none" ? "Not started" : intrinsicsStatus} severity={intrinsicsSeverity} />
            <div className="mt-1 text-xs text-ink-muted">{intrinsics?.SightingsCollected ?? 0} sightings</div>
            <div className="text-xs text-ink-muted">RMSE: {intrinsics?.CurrentRmse != null ? intrinsics.CurrentRmse.toFixed(3) : "—"}</div>
          </div>
          <div className="rounded-lg bg-slate-100 p-3">
            <div className="mb-1 text-xs text-ink-muted">Homography</div>
            <Tag label={homographyStatusLabel} severity={homographySeverity} />
            <div className="mt-1 text-xs text-ink-muted">{homographyStatusDetail}</div>
          </div>
          <div className="rounded-lg bg-slate-100 p-3">
            <div className="mb-1 text-xs text-ink-muted">ArUco Lock</div>
            <Tag label={arucoStatusLabel} severity={arucoSeverity} />
            <div className="mt-1 text-xs text-ink-muted">{arucoStatusDetail}</div>
          </div>
        </div>

        {/* Homography Snapshot */}
        {!snapshotLoading && snapshotUrl && (
          <div>
            <div className="mb-2 text-sm font-semibold text-ink">Homography Snapshot</div>
            <img
              src={snapshotUrl}
              alt="Camera snapshot"
              className="max-h-48 w-full rounded-lg border border-slate-200 object-contain"
              onError={() => setSnapshotUrl(null)}
            />
          </div>
        )}

        {/* Coverage grid */}
        {coverageGrid.length > 0 ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-ink">
                Intrinsics Coverage
                <span className="ml-1 text-xs font-normal text-ink-muted">
                  {coverageFilled} / {coverageGrid.length} cells filled
                </span>
              </div>
              {lastUpdatedLabel && <div className="text-xs text-ink-muted">Updated {lastUpdatedLabel}</div>}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-shrink-0 text-center text-xs leading-tight text-ink-muted" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                Camera left
              </div>
              <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `repeat(${coverageGridCols}, 1.25rem)` }}>
                {coverageGrid.map((cell, i) => (
                  <div key={i} className={`h-5 w-5 rounded-sm ${cell ? "bg-emerald-500" : "bg-slate-300"}`} />
                ))}
              </div>
              <div className="flex-shrink-0 text-center text-xs leading-tight text-ink-muted" style={{ writingMode: "vertical-rl" }}>
                Camera right
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-ink-muted">
            No coverage data yet. Run intrinsics calibration to populate.
            {lastUpdatedLabel && <span className="ml-1 opacity-60">(Updated {lastUpdatedLabel})</span>}
          </div>
        )}

        {hasSuggestion && <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-700">{suggestionText}</p>}

        {/* Calibration board selector */}
        <div className="border-t border-slate-200 pt-4">
          <label className="mb-1 block text-sm font-semibold text-ink">
            Calibration Board
            <select
              value={selectedBoardId}
              onChange={(e) => setSelectedBoardId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-ink"
            >
              <option value="">Select a ChArUco board...</option>
              {charucoBoards.map((b) => (
                <option key={b.Id} value={b.Id}>
                  {b.Nickname}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs text-ink-muted">Board parameters are shared by intrinsics and homography calibration.</div>
        </div>

        {/* Actions */}
        <div className="border-t border-slate-200 pt-4">
          <div className="mb-3 text-sm font-semibold text-ink">Actions</div>

          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-ink">Intrinsics Calibration</div>
              <div className="text-xs text-ink-muted">Requires ChArUco board in camera view</div>
            </div>
            <HasPermission permission={Permissions.Project.DevicesManage} projectId={device.ProjectId}>
              <button
                type="button"
                disabled={triggerLoading}
                onClick={() => void toggleIntrinsics()}
                title="Toggles BeginCalibration. Select a board above to also update CharucoBoard config when enabling."
                className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
                  isIntrinsicsEnabled ? "bg-red-600 hover:bg-red-500" : "bg-brand-600 hover:bg-brand-600/85"
                }`}
              >
                {triggerLoading ? "…" : intrinsicsButtonLabel}
              </button>
            </HasPermission>
          </div>

          {intrinsicsActionMessage && <p className="mb-3 rounded-md bg-green-50 p-3 text-sm text-green-700">{intrinsicsActionMessage}</p>}
          {intrinsicsError && (
            <p className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
              Failed to update calibration toggle. Check device connectivity.
            </p>
          )}

          <div className={`mb-3 flex items-center justify-between ${!canRunHomography && !homographyTriggered ? "opacity-50" : ""}`}>
            <div>
              <div className="text-sm font-medium text-ink">Homography</div>
              <div className="text-xs text-ink-muted">Triggers scan on all project devices simultaneously</div>
            </div>
            <HasPermission permission={Permissions.Project.DevicesManage} projectId={device.ProjectId}>
              <button
                type="button"
                disabled={!canRunHomography || homographyTriggered}
                onClick={() => void triggerHomography()}
                title={intrinsicsStatus !== "done" ? "Requires intrinsics to be complete first" : !selectedBoard ? "Select a board above" : "Sets CharucoBoard.BeginScanning on all project devices"}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-ink hover:bg-slate-100 disabled:opacity-60"
              >
                {homographyLoading ? "…" : "Run"}
              </button>
            </HasPermission>
          </div>

          {homographyTriggered && (
            <p className="mb-3 rounded-md bg-green-50 p-3 text-sm text-green-700">
              Homography scan triggered on all devices. Ensure board is visible to all cameras.
            </p>
          )}
          {homographyError && <p className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">Failed to trigger homography on one or more devices.</p>}

          <div className="flex items-center justify-between opacity-50">
            <div>
              <div className="text-sm font-medium text-ink">ArUco Lock</div>
              <div className="text-xs text-ink-muted">Device-level — run from device card</div>
            </div>
            <button type="button" disabled title="Run from the device card" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-400">
              Lock
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

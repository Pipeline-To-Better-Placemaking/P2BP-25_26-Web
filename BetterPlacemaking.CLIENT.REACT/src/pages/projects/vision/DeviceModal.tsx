import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../../components/Modal";
import { HasPermission } from "../../../auth/HasPermission";
import { Permissions } from "../../../lib/permissions";
import * as deviceApi from "../../../services/deviceApi";
import * as boardLibraryApi from "../../../services/boardLibraryApi";
import type { DeviceDto } from "../../../lib/deviceTypes";
import type { BoardLibraryItem } from "../../../lib/boardLibraryTypes";

/**
 * Ported from the Angular device-modal/{device-modal.ts,.html}. Shows Jetson
 * system health, lets the user trigger an ArUco-lock scan across every
 * project device, and edit a couple of quick device settings inline.
 */

type Severity = "success" | "warn" | "danger" | "secondary";

function Tag({ label, severity }: { label: string; severity: Severity }) {
  const classes: Record<Severity, string> = {
    success: "bg-emerald-100 text-emerald-800",
    warn: "bg-amber-100 text-amber-800",
    danger: "bg-red-100 text-red-800",
    secondary: "bg-slate-100 text-ink",
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${classes[severity]}`}>{label}</span>;
}

function serviceSeverity(active: string): Severity {
  const state = active.toLowerCase();
  if (state === "active" || state === "activating") return "success";
  if (state === "inactive") return "secondary";
  if (state === "failed" || state === "dead") return "danger";
  return "warn";
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-ink focus:border-brand-500 focus:outline-none";

interface DeviceModalProps {
  device: DeviceDto;
  allDevices: DeviceDto[];
  onClose: () => void;
}

export function DeviceModal({ device: initialDevice, allDevices, onClose }: DeviceModalProps) {
  const [device, setDevice] = useState(initialDevice);
  const [boardLibrary, setBoardLibrary] = useState<BoardLibraryItem[]>([]);
  const [selectedArucoBoardId, setSelectedArucoBoardId] = useState<string>("");

  const [trackingEnabled, setTrackingEnabled] = useState(initialDevice.Config?.Tracking?.Enabled ?? false);
  const [heartbeatInterval, setHeartbeatInterval] = useState(initialDevice.Config?.HeartbeatInterval ?? 30);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);

  const [arucoScanLoading, setArucoScanLoading] = useState(false);
  const [arucoScanTriggered, setArucoScanTriggered] = useState(false);
  const [arucoScanError, setArucoScanError] = useState(false);

  useEffect(() => {
    boardLibraryApi
      .getLibrary()
      .then(setBoardLibrary)
      .catch(() => setBoardLibrary([]));
  }, []);

  const arucoBoards = useMemo(() => boardLibrary.filter((b) => b.Type === "aruco"), [boardLibrary]);
  const selectedArucoBoard = arucoBoards.find((b) => b.Id === selectedArucoBoardId) ?? null;
  const canScanAruco = !!selectedArucoBoard && !arucoScanLoading;

  const system = device.HealthReport?.System ?? null;
  const gpuPct = system?.Gpu?.UtilizationPct ?? null;
  const gpuTempC = (system?.Gpu?.TemperatureC ?? -1) >= 0 ? system?.Gpu?.TemperatureC ?? null : null;
  const cpuTempC = (system?.CpuTemperatureC ?? -1) >= 0 ? system?.CpuTemperatureC ?? null : null;
  const memUsedMb = system?.Memory?.UsedMb ?? null;
  const memTotalMb = system?.Memory?.TotalMb ?? null;

  const cameraCount = Object.keys(device.HealthReport?.Cameras ?? {}).length;
  const enabledCameraCount = Object.values(device.HealthReport?.Cameras ?? {}).filter((c) => c?.Enabled).length;

  const arucoStatus = device.Config?.ArucoLock?.Status ?? "unlocked";
  const arucoSeverity: Severity = arucoStatus === "locked" ? "success" : arucoStatus === "scanning" ? "warn" : "secondary";

  const serviceRows = Object.entries(device.HealthReport?.Services ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, status]) => ({ name, active: status?.Active ? "active" : "inactive", sub: status?.Sub ?? "—" }));
  const degradedServiceCount = serviceRows.filter((s) => s.active !== "active" && s.active !== "activating").length;

  async function saveSettings() {
    if (!device.Id || !device.Config) return;
    setSettingsLoading(true);
    setSettingsSaved(false);
    setSettingsError(false);

    const updated: DeviceDto = {
      ...device,
      Config: {
        ...device.Config,
        HeartbeatInterval: heartbeatInterval,
        Tracking: device.Config.Tracking
          ? { ...device.Config.Tracking, Enabled: trackingEnabled }
          : { Enabled: trackingEnabled, ConfidenceThreshold: 0.5, MaxFps: 10 },
      },
    };

    try {
      const saved = await deviceApi.updateDevice(device.Id, updated);
      setDevice(saved);
      setSettingsSaved(true);
    } catch {
      setSettingsError(true);
    } finally {
      setSettingsLoading(false);
    }
  }

  async function triggerArucoScan() {
    if (!selectedArucoBoard || arucoScanLoading) return;
    setArucoScanLoading(true);
    setArucoScanError(false);

    const dict = selectedArucoBoard.Dictionary;
    const targets = allDevices.filter((d) => d.Id && d.Config);

    try {
      await Promise.all(
        targets.map((d) =>
          deviceApi.updateDevice(d.Id, {
            ...d,
            Config: {
              ...d.Config!,
              ArucoLock: { ...d.Config!.ArucoLock, BeginScanning: true, ArucoDict: dict },
            },
          }),
        ),
      );
      setArucoScanTriggered(true);
    } catch {
      setArucoScanError(true);
    } finally {
      setArucoScanLoading(false);
    }
  }

  return (
    <Modal title={device.Name || "Jetson Device"} onClose={onClose} widthClassName="max-w-xl">
      <div className="flex flex-col gap-4">
        {/* System Health */}
        <div>
          <div className="mb-3 text-sm font-semibold text-ink">System Health</div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-slate-100 p-3 text-center">
              <div className="mb-1 text-xs text-ink-muted">GPU</div>
              <div
                className={`text-xl font-bold ${
                  gpuPct != null && gpuPct < 70
                    ? "text-emerald-600"
                    : gpuPct != null && gpuPct < 90
                      ? "text-amber-600"
                      : gpuPct != null
                        ? "text-red-600"
                        : "text-ink"
                }`}
              >
                {gpuPct != null ? `${gpuPct}%` : "—"}
              </div>
              <div className="text-xs text-ink-muted">utilization</div>
              <div className="mt-1 text-xs text-ink-muted">{gpuTempC != null ? `${gpuTempC}°C` : "—"}</div>
            </div>
            <div className="rounded-lg bg-slate-100 p-3 text-center">
              <div className="mb-1 text-xs text-ink-muted">RAM</div>
              <div className="text-xl font-bold text-ink">{memUsedMb ?? "—"}</div>
              <div className="text-xs text-ink-muted">/ {memTotalMb ?? "—"} MB</div>
              <div className="mt-1 text-xs text-ink-muted">CPU {cpuTempC != null ? `${cpuTempC}°C` : "—"}</div>
            </div>
            <div className="rounded-lg bg-slate-100 p-3 text-center">
              <div className="mb-1 text-xs text-ink-muted">Cameras</div>
              <div className="text-xl font-bold text-ink">{enabledCameraCount}</div>
              <div className="text-xs text-ink-muted">/ {cameraCount} enabled</div>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-muted">ArUco Lock:</span>
              <Tag label={arucoStatus} severity={arucoSeverity} />
            </div>
            <select
              value={selectedArucoBoardId}
              onChange={(e) => setSelectedArucoBoardId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select ArUco board...</option>
              {arucoBoards.map((b) => (
                <option key={b.Id} value={b.Id}>
                  {b.Nickname}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <HasPermission permission={Permissions.Project.DevicesManage} projectId={device.ProjectId}>
                <button
                  type="button"
                  disabled={!canScanAruco || arucoScanTriggered}
                  onClick={() => void triggerArucoScan()}
                  title="Triggers ArucoLock.BeginScanning on all project devices"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-ink hover:bg-slate-100 disabled:opacity-60"
                >
                  {arucoScanLoading ? "Scanning…" : "Scan"}
                </button>
              </HasPermission>
              {arucoScanTriggered && (
                <p className="flex-1 rounded-md bg-green-50 px-2 py-1 text-xs text-green-700">
                  ArUco scan triggered on all devices.
                </p>
              )}
              {arucoScanError && (
                <p className="flex-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">
                  Scan failed on one or more devices.
                </p>
              )}
            </div>
            <div className="text-xs text-ink-muted">Place the ArUco marker in view of all cameras before scanning.</div>
          </div>
        </div>

        {/* Quick Settings */}
        <HasPermission permission={Permissions.Project.DevicesRead} projectId={device.ProjectId}>
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="mb-3 text-sm font-semibold text-ink">Quick Settings</div>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">Tracking</div>
                  <div className="text-xs text-ink-muted">Enable or disable person detection</div>
                  <div className="mt-1 text-xs text-ink-muted">Current: {trackingEnabled ? "Enabled" : "Disabled"}</div>
                </div>
                <HasPermission permission={Permissions.Project.DevicesManage} projectId={device.ProjectId}>
                  <button
                    type="button"
                    onClick={() => setTrackingEnabled((v) => !v)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                      trackingEnabled ? "bg-emerald-600 text-white" : "bg-slate-200 text-ink"
                    }`}
                  >
                    {trackingEnabled ? "Enabled" : "Disabled"}
                  </button>
                </HasPermission>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">Heartbeat Interval</div>
                  <div className="text-xs text-ink-muted">How often the device reports health (seconds)</div>
                  <div className="mt-1 text-xs text-ink-muted">Current: {heartbeatInterval} seconds</div>
                </div>
                <HasPermission permission={Permissions.Project.DevicesManage} projectId={device.ProjectId}>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    step={5}
                    value={heartbeatInterval}
                    onChange={(e) => setHeartbeatInterval(Number(e.target.value))}
                    className="w-24 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-ink"
                  />
                </HasPermission>
              </div>

              <div className="flex items-center gap-2">
                <HasPermission permission={Permissions.Project.DevicesManage} projectId={device.ProjectId}>
                  <button
                    type="button"
                    disabled={settingsLoading}
                    onClick={() => void saveSettings()}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-60"
                  >
                    {settingsLoading ? "Saving…" : "Save Changes"}
                  </button>
                </HasPermission>
                {settingsSaved && <p className="flex-1 rounded-md bg-green-50 px-2 py-1 text-xs text-green-700">Saved.</p>}
                {settingsError && <p className="flex-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">Save failed.</p>}
              </div>
            </div>
          </div>
        </HasPermission>

        {/* Services */}
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">Services</span>
            {degradedServiceCount > 0 && <Tag label={`${degradedServiceCount} degraded`} severity="warn" />}
          </div>

          {serviceRows.length === 0 ? (
            <p className="text-sm text-ink-muted">No services reported.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {serviceRows.map((svc) => (
                <div key={svc.name} className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-b-0">
                  <span className="font-mono text-sm text-ink">{svc.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-muted">{svc.sub}</span>
                    <Tag label={svc.active} severity={serviceSeverity(svc.active)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

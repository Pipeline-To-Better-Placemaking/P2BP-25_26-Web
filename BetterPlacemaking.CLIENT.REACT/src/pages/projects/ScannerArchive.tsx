import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { HasPermission } from "../../auth/HasPermission";
import { ApiError } from "../../auth/apiClient";
import { Permissions } from "../../lib/permissions";
import * as deviceApi from "../../services/deviceApi";
import * as floorplanLibraryApi from "../../services/floorplanLibraryApi";
import * as scanApi from "../../services/scanApi";
import * as scanCalibrationApi from "../../services/scanCalibrationApi";
import type { DeviceDto } from "../../lib/deviceTypes";
import type { FloorplanLibraryItemDto } from "../../lib/floorplanTypes";
import { BASE_SCAN_SETTINGS, SCAN_PRESETS, type ScanPreset, type ScanRecordDto, type ScanScheduleDto, type ScanSettingsRequest } from "../../lib/scanTypes";
import { Modal } from "../../components/Modal";
import { MultiLidarCalibration } from "./MultiLidarCalibration";
import { FloorplanLibraryPanel } from "./scanner/FloorplanLibraryPanel";
import { ScanHistoryTable } from "./scanner/ScanHistoryTable";
import { ScanSchedulePanel } from "./scanner/ScanSchedulePanel";
import { ScanSettingsPanel } from "./scanner/ScanSettingsPanel";
import { ScanVisualPanel, type ScannerVisualMode } from "./scanner/ScanVisualPanel";
import {
  FREQUENCY_OPTIONS,
  type FrequencyOption,
  combineDateAndTime,
  formatDatePart,
  formatScanDateTime,
  formatTimePart,
  getLatestScan,
  getScanStatusLabel,
  isLidarConnected,
  isScheduleDue,
  sortScansNewestFirst,
} from "./scanner/scannerHelpers";

/**
 * Ported from BetterPlacemaking.CLIENT/src/app/views/admin/devices/scanner/{scanner.ts,scanner.html}
 * (963 + 586 lines - the largest single page in the old Angular app). Despite living under the old
 * `views/admin/devices/scanner` folder, this is a PROJECT-scoped route (`:projectId/model`,
 * permission `Project.Scans.Read`), the same organizational-folder-vs-route-scope split already
 * used for MultiLidarCalibration.
 *
 * Composes: LiDAR device resolution + scan settings/presets, a client-evaluated scan schedule
 * watcher, the shared floorplan library (for scan-to-floorplan calibration reference), scan
 * history with live status polling, the embedded MultiLidarCalibration workspace (controlled-props
 * mode - this page owns device/floorplan/scan-history state and passes it down), and a 2D/3D
 * viewport (SolidObjectsView / PointCloudViewer) for the scan preview - see ScanVisualPanel.tsx for
 * why that viewport currently renders an empty scene (no ported raw point-cloud/cluster data
 * source yet).
 *
 * Backend calls, cross-checked against the real route handlers (not just the old Angular services):
 *  - scan.routes.ts (GET/POST /:projectId/:deviceId, DELETE /:projectId/:deviceId/:scanId) - REAL.
 *  - scanSchedule.routes.ts (GET/POST /:projectId, PUT/DELETE /:projectId/:scheduleId) - REAL;
 *    scanApi.ts gained getSchedules/createSchedule/updateSchedule/deleteSchedule for this page.
 *  - device.routes.ts (GET /project/:projectId) - REAL, used to resolve "the" lidar device (first
 *    project device whose Name contains "lidar", matching the old Angular heuristic - there is no
 *    dedicated "device type" field on DeviceDto to key off of instead).
 *  - floorplanLibrary.routes.ts (GET/upload/DELETE) - REAL, shared with MultiLidarCalibration/Vision.
 *  - scanCalibration.routes.ts's GET .../download - REAL, used for the scan-history row's
 *    "download" link (matches the old scanner.ts's getCalibrationDownloadUrl, which uses the
 *    ScanCalibration download endpoint, not scan.routes.ts's always-404 raw `.../xyz` endpoint).
 *  - The scan-schedule "due" check (isScheduleDue et al. in scanner/scannerHelpers.ts) is
 *    client-evaluated against a 15s poll, exactly like the old Angular RxJS interval watcher - it
 *    only runs while this page is open, no different from the old behavior.
 */

const SCHEDULE_POLL_MS = 15_000;
const SCAN_STATUS_POLL_MS = 3_000;

function toLocalInputValue(date: Date): string {
  // yyyy-MM-ddThh:mm, in the browser's local timezone, for a datetime-local input.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getScanStartErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) {
    const body = err.body as { message?: string } | undefined;
    if (typeof body?.message === "string" && body.message.trim()) return body.message.trim();
    return "A scan is already in progress for this device.";
  }
  return "Failed to start scan.";
}

function StatCard({ label, value, valueClassName, meta }: { label: string; value: string; valueClassName?: string; meta: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold text-neutral-900 ${valueClassName ?? ""}`}>{value}</div>
      <div className="mt-1 text-xs text-neutral-500">{meta}</div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="mt-6 rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <div className="text-sm font-semibold text-neutral-900">{title}</div>
        <div className="text-xs text-neutral-500">{subtitle}</div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Scanner() {
  const { projectId } = useParams();

  const [visualMode, setVisualMode] = useState<ScannerVisualMode>("solids");

  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanMessageSeverity, setScanMessageSeverity] = useState<"success" | "info" | "warn" | "error">("info");
  const [scanning, setScanning] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);

  const [scheduledDateTime, setScheduledDateTime] = useState("");
  const [endDateTime, setEndDateTime] = useState("");
  const [selectedFrequency, setSelectedFrequency] = useState<FrequencyOption | undefined>(undefined);
  const [schedules, setSchedules] = useState<ScanScheduleDto[]>([]);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);

  const [scanSettings, setScanSettings] = useState<ScanSettingsRequest>({ ...BASE_SCAN_SETTINGS });
  const [selectedPreset, setSelectedPreset] = useState<ScanPreset | null>("base");

  const [currentScanStatus, setCurrentScanStatus] = useState<string | null>(null);
  const [currentScanRecord, setCurrentScanRecord] = useState<ScanRecordDto | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanRecordDto[]>([]);
  const [deletingScanId, setDeletingScanId] = useState<string | null>(null);

  const [lidarCalibrationVisible, setLidarCalibrationVisible] = useState(false);

  const [floorplans, setFloorplans] = useState<FloorplanLibraryItemDto[]>([]);
  const [floorplansLoading, setFloorplansLoading] = useState(false);
  const [uploadingFloorplan, setUploadingFloorplan] = useState(false);
  const [selectedFloorplanId, setSelectedFloorplanId] = useState<string | null>(null);

  const [currentLidarDeviceId, setCurrentLidarDeviceId] = useState<string | null>(null);
  const [currentLidarDeviceName, setCurrentLidarDeviceName] = useState<string | null>(null);
  const [lidarConnected, setLidarConnected] = useState(false);

  const scanStatusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningScheduleIdsRef = useRef<Set<string>>(new Set());
  const performScanRef = useRef<() => void>(() => {});
  const checkSchedulesRef = useRef<() => void>(() => {});

  const selectedFloorplan = useMemo(
    () => floorplans.find((f) => f.Id === selectedFloorplanId) ?? null,
    [floorplans, selectedFloorplanId],
  );
  const successCount = useMemo(
    () => scanHistory.filter((s) => ["complete", "done"].includes((s.Status ?? "").toLowerCase())).length,
    [scanHistory],
  );
  const failedCount = useMemo(
    () => scanHistory.filter((s) => ["error", "failed"].includes((s.Status ?? "").toLowerCase())).length,
    [scanHistory],
  );

  function loadSchedules(pid: string) {
    scanApi
      .getSchedules(pid)
      .then(setSchedules)
      .catch(() => console.error("Failed to load scan schedules"));
  }

  function loadScanHistory(pid: string, deviceId: string) {
    scanApi
      .getScans(pid, deviceId)
      .then((scans) => setScanHistory(sortScansNewestFirst(scans ?? [])))
      .catch(() => setScanHistory([]));
  }

  function resolveLidarDeviceAndLoadHistory(pid: string) {
    deviceApi
      .getDevicesByProject(pid)
      .then((devices) => {
        const lidarDevice = devices.find((d) => d.ProjectId === pid && d.Name?.toLowerCase().includes("lidar"));
        if (!lidarDevice) return;
        setCurrentLidarDeviceId(lidarDevice.Id);
        setCurrentLidarDeviceName(lidarDevice.Name ?? "LiDAR device");
        setLidarConnected(isLidarConnected(lidarDevice));
        loadScanHistory(pid, lidarDevice.Id);
      })
      .catch(() => {});
  }

  function loadFloorplans(pid: string) {
    setFloorplansLoading(true);
    floorplanLibraryApi
      .getFloorplanLibrary(pid)
      .then((items) => {
        setFloorplans(items);
        setFloorplansLoading(false);
        setSelectedFloorplanId((current) => {
          if (!current && items.length > 0) return items[0].Id;
          if (current && !items.find((f) => f.Id === current)) return items[0]?.Id ?? null;
          return current;
        });
      })
      .catch(() => setFloorplansLoading(false));
  }

  function stopScanStatusPolling() {
    if (scanStatusPollRef.current) {
      clearInterval(scanStatusPollRef.current);
      scanStatusPollRef.current = null;
    }
  }

  function startScanStatusPolling(pid: string, deviceId: string) {
    stopScanStatusPolling();
    scanStatusPollRef.current = setInterval(() => {
      scanApi
        .getScans(pid, deviceId)
        .then((scans) => {
          if (!scans?.length) return;
          const latest = getLatestScan(scans);
          setScanHistory(sortScansNewestFirst(scans));
          if (!latest) return;

          let status = (latest.Status ?? "").toLowerCase();
          if ((status === "complete" || status === "done") && !latest.ObjUrl) {
            status = "failed";
            setCurrentScanRecord({ ...latest, Status: "failed", Error: latest.Error ?? "LiDAR did not produce scan data" });
          } else {
            setCurrentScanRecord(latest);
          }
          setCurrentScanStatus(status);

          if (["complete", "done", "error", "failed"].includes(status)) {
            stopScanStatusPolling();
          }
        })
        .catch(() => {});
    }, SCAN_STATUS_POLL_MS);
  }

  async function performScan() {
    if (!projectId) {
      setScanMessage("No project selected.");
      setScanMessageSeverity("error");
      return;
    }

    setScanning(true);
    setScanMessage(null);
    setScanMessageSeverity("info");

    let devices: DeviceDto[];
    try {
      devices = await deviceApi.getDevicesByProject(projectId);
    } catch {
      setScanMessage("Failed to load devices.");
      setScanMessageSeverity("error");
      setScanning(false);
      return;
    }

    const projectDevices = devices.filter((d) => d.ProjectId === projectId && d.Name?.toLowerCase().includes("lidar"));
    if (projectDevices.length === 0) {
      setScanMessage("No lidar device assigned to this project.");
      setScanMessageSeverity("error");
      setScanning(false);
      return;
    }

    const lidarDevice = projectDevices[0];
    setCurrentLidarDeviceName(lidarDevice.Name ?? "LiDAR device");
    const connected = isLidarConnected(lidarDevice);
    setLidarConnected(connected);
    setCurrentLidarDeviceId(lidarDevice.Id);
    setCurrentScanStatus("pending");
    setCurrentScanRecord({ Id: "", Status: "pending" });

    if (!connected) {
      setScanMessage("Warning: LiDAR reports as offline, but attempting scan anyway.");
      setScanMessageSeverity("warn");
    }

    try {
      await scanApi.startScan(projectId, lidarDevice.Id, scanSettings);
      setScanMessage("Scan requested successfully.");
      setScanMessageSeverity("success");
      setScanning(false);
      startScanStatusPolling(projectId, lidarDevice.Id);
      loadScanHistory(projectId, lidarDevice.Id);
      setTimeout(() => {
        setScanMessage(null);
        setScanMessageSeverity("info");
      }, 5000);
    } catch (err) {
      setScanMessage(getScanStartErrorMessage(err));
      setScanMessageSeverity("error");
      setScanning(false);
    }
  }

  function runScheduledScan(schedule: ScanScheduleDto) {
    if (!schedule.Id || !projectId) return;

    runningScheduleIdsRef.current.add(schedule.Id);
    setScanMessage(`Scheduled scan started for ${schedule.StartDate} ${schedule.StartTime}.`);
    setScanMessageSeverity("info");

    performScanRef.current();

    const lastRunAt = new Date().toISOString();
    const updatedSchedule: ScanScheduleDto = { ...schedule, LastRunAt: lastRunAt };

    scanApi
      .updateSchedule(projectId, schedule.Id, updatedSchedule)
      .then(() => {
        runningScheduleIdsRef.current.delete(schedule.Id!);
        loadSchedules(projectId);
      })
      .catch(() => {
        runningScheduleIdsRef.current.delete(schedule.Id!);
      });
  }

  function checkSchedulesAndRunScans() {
    if (!projectId || scanning || schedules.length === 0) return;

    const now = new Date();
    for (const schedule of schedules) {
      if (!schedule.Id) continue;
      if (runningScheduleIdsRef.current.has(schedule.Id)) continue;

      if (isScheduleDue(schedule, now, SCHEDULE_POLL_MS)) {
        runScheduledScan(schedule);
        break;
      }
    }
  }

  // Keep both refs pointing at the freshest closure (latest projectId/scanSettings/schedules/
  // scanning) so the schedule-watcher interval below - set up once per projectId - always acts on
  // current state, mirroring the old Angular component's instance fields being read live.
  useEffect(() => {
    performScanRef.current = performScan;
    checkSchedulesRef.current = checkSchedulesAndRunScans;
  });

  useEffect(() => {
    if (!projectId) return;

    loadSchedules(projectId);
    resolveLidarDeviceAndLoadHistory(projectId);
    loadFloorplans(projectId);

    checkSchedulesRef.current();
    const scheduleTimer = setInterval(() => checkSchedulesRef.current(), SCHEDULE_POLL_MS);

    return () => {
      clearInterval(scheduleTimer);
      stopScanStatusPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-per-project effect; loaders read projectId via their own `pid` argument.
  }, [projectId]);

  function applyPreset(preset: ScanPreset) {
    setSelectedPreset(preset);
    setScanSettings({ ...SCAN_PRESETS[preset] });
  }

  function resetToBaseSettings() {
    setSelectedPreset("base");
    setScanSettings({ ...BASE_SCAN_SETTINGS });
  }

  function handleSettingChange<K extends keyof ScanSettingsRequest>(key: K, value: ScanSettingsRequest[K]) {
    setScanSettings((prev) => ({ ...prev, [key]: value }));
    setSelectedPreset(null);
  }

  function handleScheduledDateTimeChange(value: string) {
    setScheduledDateTime(value);
    if (value && endDateTime && new Date(endDateTime) <= new Date(value)) {
      setEndDateTime("");
    }
  }

  function clearScheduleForm() {
    setScheduledDateTime("");
    setEndDateTime("");
    setSelectedFrequency(undefined);
    setEditingScheduleId(null);
  }

  function scheduleScan() {
    if (!projectId) return;

    if (!selectedFrequency) {
      setScheduleMessage("Please select a frequency.");
      return;
    }
    if (!scheduledDateTime) {
      setScheduleMessage("Please select a start date and time.");
      return;
    }

    const startDate = new Date(scheduledDateTime);
    let endDate: Date | null = null;
    if (selectedFrequency.code !== "Never") {
      if (!endDateTime) {
        setScheduleMessage("Please select an end date and time for recurring scans.");
        return;
      }
      endDate = new Date(endDateTime);
      if (endDate <= startDate) {
        setScheduleMessage("End date and time must be after start.");
        return;
      }
    }

    const payload: ScanScheduleDto = {
      StartDate: formatDatePart(startDate),
      StartTime: formatTimePart(startDate),
      Frequency: selectedFrequency.code,
      EndDate: endDate ? formatDatePart(endDate) : undefined,
      EndTime: endDate ? formatTimePart(endDate) : undefined,
    };

    const onSuccess = (successMessage: string) => {
      setScheduleMessage(successMessage);
      clearScheduleForm();
      loadSchedules(projectId);
      setTimeout(() => setScheduleMessage(null), 3000);
    };

    if (editingScheduleId) {
      scanApi
        .updateSchedule(projectId, editingScheduleId, payload)
        .then(() => onSuccess("Schedule updated."))
        .catch(() => setScheduleMessage("Failed to update schedule."));
    } else {
      scanApi
        .createSchedule(projectId, payload)
        .then(() => onSuccess("Scan scheduled successfully!"))
        .catch(() => setScheduleMessage("Failed to save schedule."));
    }
  }

  function cancelSchedule(id: string) {
    if (!projectId) return;
    scanApi
      .deleteSchedule(projectId, id)
      .then(() => loadSchedules(projectId))
      .catch(() => setScheduleMessage("Failed to delete schedule."));
  }

  function editSchedule(schedule: ScanScheduleDto) {
    const start = combineDateAndTime(schedule.StartDate, schedule.StartTime);
    setScheduledDateTime(toLocalInputValue(start));
    setEndDateTime(
      schedule.EndDate && schedule.EndTime ? toLocalInputValue(combineDateAndTime(schedule.EndDate, schedule.EndTime)) : "",
    );
    setSelectedFrequency(FREQUENCY_OPTIONS.find((f) => f.code === schedule.Frequency));
    setEditingScheduleId(schedule.Id ?? null);
  }

  function handleSelectFloorplan(id: string) {
    setSelectedFloorplanId(id);
  }

  function handleUploadFloorplan(file: File) {
    if (!projectId) return;
    const nickname = file.name.replace(/\.[^.]+$/, "");
    setUploadingFloorplan(true);
    floorplanLibraryApi
      .uploadFloorplan(file, nickname, projectId)
      .then(() => {
        setUploadingFloorplan(false);
        loadFloorplans(projectId);
      })
      .catch(() => setUploadingFloorplan(false));
  }

  function handleDeleteFloorplan(id: string) {
    if (!projectId) return;
    floorplanLibraryApi
      .deleteFloorplan(id)
      .then(() => loadFloorplans(projectId))
      .catch(() => {});
  }

  function openLidarCalibration() {
    if (!selectedFloorplan) {
      setScanMessage("Select a floorplan before opening LiDAR calibration.");
      setScanMessageSeverity("error");
      return;
    }
    setLidarCalibrationVisible(true);
  }

  function handleDeleteScan(scan: ScanRecordDto) {
    if (!projectId || !currentLidarDeviceId || !scan.Id) return;
    setDeletingScanId(scan.Id);
    scanApi
      .deleteScan(projectId, currentLidarDeviceId, scan.Id)
      .then(() => {
        setScanHistory((prev) => prev.filter((s) => s.Id !== scan.Id));
        if (currentScanRecord?.Id === scan.Id) {
          setCurrentScanRecord(null);
          setCurrentScanStatus(null);
        }
        setDeletingScanId(null);
        setScanMessage("Scan history entry deleted.");
        setScanMessageSeverity("success");
        setTimeout(() => {
          setScanMessage(null);
          setScanMessageSeverity("info");
        }, 3000);
      })
      .catch(() => {
        setDeletingScanId(null);
        setScanMessage("Failed to delete scan history entry.");
        setScanMessageSeverity("error");
      });
  }

  function getCalibrationDownloadUrl(scanId: string): string {
    if (!projectId || !currentLidarDeviceId) return "#";
    return scanCalibrationApi.getDownloadUrl(projectId, currentLidarDeviceId, scanId);
  }

  const messageBoxClass = {
    success: "bg-green-50 text-green-700",
    info: "bg-indigo-50 text-indigo-700",
    warn: "bg-amber-50 text-amber-700",
    error: "bg-red-50 text-red-700",
  }[scanMessageSeverity];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">LiDAR Scanning</h1>
          <p className="mt-1 text-sm text-neutral-600">Run scans, track progress, view history, and manage scan schedules</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <HasPermission permission={Permissions.Project.ScansStart} projectId={projectId}>
            <button
              type="button"
              onClick={resetToBaseSettings}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Reset to Base
            </button>
          </HasPermission>
          <HasPermission permission={Permissions.Project.ScansStart} projectId={projectId}>
            <button
              type="button"
              onClick={() => void performScan()}
              disabled={scanning}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {scanning ? "Requesting…" : "Perform Scan"}
            </button>
          </HasPermission>
        </div>
      </div>

      {scanMessage && <p className={`mt-4 rounded-md p-3 text-sm ${messageBoxClass}`}>{scanMessage}</p>}

      {currentScanStatus && (
        <p className="mt-4 rounded-md bg-neutral-100 p-3 text-sm text-neutral-700">
          Current status: {getScanStatusLabel(currentScanStatus)}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Current Status"
          value={currentScanStatus ? getScanStatusLabel(currentScanStatus) : "—"}
          valueClassName={
            currentScanStatus === "complete" || currentScanStatus === "done"
              ? "text-green-600"
              : currentScanStatus === "error" || currentScanStatus === "failed"
                ? "text-red-600"
                : currentScanStatus === "running" || currentScanStatus === "in_progress" || currentScanStatus === "calibrating"
                  ? "text-indigo-600"
                  : ""
          }
          meta={currentScanRecord ? formatScanDateTime(currentScanRecord.CreatedAt) : "No active scan"}
        />
        <StatCard
          label="Successful"
          value={String(successCount)}
          valueClassName={successCount > 0 ? "text-green-600" : ""}
          meta={`of ${scanHistory.length} total`}
        />
        <StatCard
          label="Failed"
          value={String(failedCount)}
          valueClassName={failedCount > 0 ? "text-red-600" : ""}
          meta="runs with errors"
        />
        <StatCard
          label="LiDAR"
          value={lidarConnected ? "Connected" : "Offline"}
          valueClassName={lidarConnected ? "text-green-600" : "text-red-600"}
          meta={currentLidarDeviceName || "No LiDAR device found"}
        />
      </div>

      <HasPermission permission={Permissions.Project.ScansStart} projectId={projectId}>
        <Card title="Scan Settings" subtitle="Current request configuration">
          <ScanSettingsPanel
            scanSettings={scanSettings}
            selectedPreset={selectedPreset}
            onApplyPreset={applyPreset}
            onSettingChange={handleSettingChange}
          />
        </Card>
      </HasPermission>

      <HasPermission permission={Permissions.Project.ScanSchedulesRead} projectId={projectId}>
        <Card title="Scan Scheduling" subtitle="Create and manage recurring scan jobs">
          <ScanSchedulePanel
            projectId={projectId}
            schedules={schedules}
            scheduledDateTime={scheduledDateTime}
            endDateTime={endDateTime}
            selectedFrequency={selectedFrequency}
            editingScheduleId={editingScheduleId}
            scheduleMessage={scheduleMessage}
            onScheduledDateTimeChange={handleScheduledDateTimeChange}
            onEndDateTimeChange={setEndDateTime}
            onFrequencyChange={setSelectedFrequency}
            onSubmit={scheduleScan}
            onEdit={editSchedule}
            onCancel={cancelSchedule}
          />
        </Card>
      </HasPermission>

      <HasPermission permission={Permissions.Project.Read} projectId={projectId}>
        <Card title="LiDAR Calibration" subtitle="Use the shared floorplan library and open calibration in a popout">
          <FloorplanLibraryPanel
            projectId={projectId}
            floorplans={floorplans}
            floorplansLoading={floorplansLoading}
            uploadingFloorplan={uploadingFloorplan}
            selectedFloorplanId={selectedFloorplanId}
            onSelect={handleSelectFloorplan}
            onUpload={handleUploadFloorplan}
            onDelete={handleDeleteFloorplan}
            onOpenCalibration={openLidarCalibration}
            calibrationDisabled={!selectedFloorplan}
          />
        </Card>
      </HasPermission>

      <HasPermission permission={Permissions.Project.ScansRead} projectId={projectId}>
        <Card title="Scan History" subtitle="Recent LiDAR runs">
          <ScanHistoryTable
            projectId={projectId}
            scanHistory={scanHistory}
            currentLidarDeviceName={currentLidarDeviceName}
            deletingScanId={deletingScanId}
            getDownloadUrl={getCalibrationDownloadUrl}
            onDelete={handleDeleteScan}
          />
        </Card>
      </HasPermission>

      {lidarCalibrationVisible && (
        <Modal title="LiDAR Calibration" onClose={() => setLidarCalibrationVisible(false)} widthClassName="max-w-[95vw]">
          <MultiLidarCalibration
            projectId={projectId}
            deviceId={currentLidarDeviceId}
            floorPlan={selectedFloorplan}
            scanHistory={scanHistory}
          />
        </Modal>
      )}

      <ScanVisualPanel visualMode={visualMode} onVisualModeChange={setVisualMode} />
    </div>
  );
}

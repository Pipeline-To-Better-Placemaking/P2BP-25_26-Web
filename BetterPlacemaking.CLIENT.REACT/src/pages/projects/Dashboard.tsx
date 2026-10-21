import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ApiError } from "../../auth/apiClient";
import { HasPermission } from "../../auth/HasPermission";
import { Modal } from "../../components/Modal";
import { Permissions } from "../../lib/permissions";
import * as deviceApi from "../../services/deviceApi";
import * as scanApi from "../../services/scanApi";
import { BASE_SCAN_SETTINGS } from "../../lib/scanTypes";
import type { DeviceDto } from "../../lib/deviceTypes";
import type { ProjectDto } from "../../lib/projectTypes";
import type { ScanRecordDto } from "../../lib/scanTypes";
import type {
  AlertCounts,
  DashboardAlert,
  DeviceCounts,
  DeviceStatus,
  ProjectViewModel,
} from "../../lib/dashboardTypes";
import { StatsWidget } from "./dashboard/StatsWidget";
import { DevicesWidget } from "./dashboard/DevicesWidget";
import { AlertsWidget } from "./dashboard/AlertsWidget";
import { ScanStatusWidget } from "./dashboard/ScanStatusWidget";
import { ProjectChecklistWidget } from "./dashboard/ProjectChecklistWidget";

/**
 * Ported from BetterPlacemaking.CLIENT's views/projects/selected/dashboard/dashboard.ts. Mounted
 * at both `/:projectId` (index) and `/:projectId/dashboard` in the Angular route table, both
 * guarded by `Project.Read` - App.tsx wires those two <Route> entries to this component
 * separately (not edited here, per migration convention).
 *
 * All five widgets are backed by real, already-ported Express resources:
 *  - StatsWidget: ProjectDto (from ProjectWorkspace's Outlet context) + the device counts below.
 *  - DevicesWidget: deviceApi.getDevicesByProject (/api/device/project/:projectId).
 *  - AlertsWidget: derived client-side from DeviceDto.HealthReport (there's no database
 *    "alerts" collection on either server - the Angular dashboard synthesized these too from
 *    offline/degraded-service detection, ported faithfully below).
 *  - ScanStatusWidget: scanApi.getScans/startScan (/api/scan/:projectId/:deviceId), already
 *    mounted on the Express server.
 *  - ProjectChecklistWidget: purely derived from the above.
 *
 * Nothing here depends on the unported Rplidar/Fusion/Visualizer pipeline - "Run Full Scan"
 * calls the same device-command scan endpoint DevicesList's siblings use, not the visualizer.
 * The one loose end is the "Last Scan" panel's click-through to the project's 3D model page
 * (`/:projectId/model` in the old Angular table) - that Visualizer page doesn't exist in this
 * React client yet since its backend pipeline isn't ported, so the navigate() call below is
 * preserved for when that route lands but currently has nowhere to go.
 */

const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;
const HEARTBEAT_GRACE_MULTIPLIER = 6;
const MIN_ONLINE_WINDOW_MS = 2 * 60 * 1000;

function getHealthReportDate(device: DeviceDto): Date | null {
  const timestamp = device.HealthReport?.Timestamp;
  if (!timestamp) return null;
  const ms = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isHeartbeatFresh(device: DeviceDto): boolean {
  const lastReportDate = getHealthReportDate(device);
  if (!lastReportDate) return false;

  const configuredInterval = Number(device.Config?.HeartbeatInterval);
  const heartbeatIntervalSeconds =
    Number.isFinite(configuredInterval) && configuredInterval > 0
      ? configuredInterval
      : DEFAULT_HEARTBEAT_INTERVAL_SECONDS;

  const maxAgeMs = Math.max(MIN_ONLINE_WINDOW_MS, heartbeatIntervalSeconds * 1000 * HEARTBEAT_GRACE_MULTIPLIER);
  return Date.now() - lastReportDate.getTime() <= maxAgeMs;
}

/**
 * Ported from Dashboard.getDeviceStatus. Note: the old Angular ServiceStatus.Active was a
 * string ('active'/'activating'/other); this codebase's already-ported DeviceDto (see
 * lib/deviceTypes.ts, matching the Express server's device.ts model) instead defines
 * `Active: boolean`, same as DeviceHealthReport.tsx already assumes - so "degraded" here means
 * `Active === false`, the boolean equivalent of the old string check.
 */
function getDeviceStatus(device: DeviceDto): DeviceStatus {
  if (!isHeartbeatFresh(device)) return "offline";

  // LiDAR devices are considered healthy as long as their heartbeat is fresh.
  if (device.Name?.toLowerCase().includes("lidar")) return "online";

  const services = device.HealthReport?.Services;
  if (!services) return "warning";

  const entries = Object.values(services);
  if (entries.length === 0) return "warning";

  const hasDegradedService = entries.some((s) => !s.Active);
  return hasDegradedService ? "warning" : "online";
}

function formatTimeAgo(date: Date): string {
  if (!date || date.getTime() === 0) return "No scans yet";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
}

function getDeviceLastSeen(device: DeviceDto): string {
  const date = getHealthReportDate(device);
  if (!date) return "N/A";
  return formatTimeAgo(date);
}

function computeDeviceCounts(devices: DeviceDto[]): DeviceCounts {
  let online = 0;
  let offline = 0;
  let warning = 0;

  devices.forEach((device) => {
    const status = getDeviceStatus(device);
    if (status === "online") online++;
    else if (status === "offline") offline++;
    else warning++;
  });

  return { total: devices.length, online, offline, warning };
}

function buildAlerts(devices: DeviceDto[]): DashboardAlert[] {
  const now = new Date();
  const alerts: DashboardAlert[] = [];

  devices.forEach((device) => {
    const status = getDeviceStatus(device);
    const timestamp = getHealthReportDate(device) ?? now;
    const deviceName = device.Name || "Unnamed device";

    if (status === "offline") {
      if (!device.HealthReport) {
        alerts.push({
          id: `device-offline-no-report-${device.Id}`,
          severity: "critical",
          message: `${deviceName} is offline and not reporting health data.`,
          timestamp,
          resolved: false,
        });
        return;
      }

      alerts.push({
        id: `device-offline-${device.Id}`,
        severity: "critical",
        message: `${deviceName} has not reported recently (last seen ${getDeviceLastSeen(device)}).`,
        timestamp,
        resolved: false,
      });
      return;
    }

    if (status === "warning") {
      const degradedServices = Object.entries(device.HealthReport?.Services ?? {})
        .filter(([, service]) => !service.Active)
        .map(([name, service]) => `${name} (${service.Sub ?? "inactive"})`);

      alerts.push({
        id: `device-warning-${device.Id}`,
        severity: "high",
        message:
          degradedServices.length > 0
            ? `${deviceName} has degraded services: ${degradedServices.join(", ")}.`
            : `${deviceName} is reporting but service health is incomplete.`,
        timestamp,
        resolved: false,
      });
    }
  });

  return alerts;
}

function computeAlertCounts(alerts: DashboardAlert[]): AlertCounts {
  return {
    total: alerts.length,
    critical: alerts.filter((a) => a.severity === "critical").length,
    high: alerts.filter((a) => a.severity === "high").length,
    unresolved: alerts.filter((a) => !a.resolved).length,
  };
}

function calculateProjectProgress(devices: DeviceDto[], counts: DeviceCounts): number {
  if (devices.length === 0) return 0;

  const total = counts.total || 1;
  const offlineRatio = counts.offline / total;
  const warningRatio = counts.warning / total;

  let progress = 100;
  progress -= offlineRatio * 60;
  progress -= warningRatio * 30;

  return Math.max(0, Math.round(progress));
}

function getProjectStatus(progress: number, started: boolean): ProjectViewModel["status"] {
  if (!started) return "inactive";
  if (progress >= 100) return "completed";
  return "active";
}

function getProjectChecklistMessage(devices: DeviceDto[], counts: DeviceCounts): string | null {
  if (devices.length === 0) return "Needs to add devices.";
  if (counts.offline > 0) return "Needs to fix offline devices.";
  if (counts.warning > 0) return "Needs to resolve device warnings.";
  return "Project is ready.";
}

function getScanTimestamp(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === "object" && "seconds" in (value as Record<string, unknown>)) {
    const seconds = (value as { seconds?: number }).seconds;
    if (typeof seconds === "number") return seconds * 1000;
  }
  return 0;
}

function computeLastScanTime(scans: ScanRecordDto[]): Date {
  const completed = scans
    .filter((s) => {
      const status = (s.Status ?? "").toLowerCase();
      return status === "complete" || status === "done";
    })
    .sort((a, b) => getScanTimestamp(b.FinishedAt ?? b.CreatedAt) - getScanTimestamp(a.FinishedAt ?? a.CreatedAt));

  const last = completed[0];
  return last ? new Date(getScanTimestamp(last.FinishedAt ?? last.CreatedAt)) : new Date(0);
}

function getScanStartErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) {
    const body = err.body as { message?: string } | undefined;
    if (body?.message?.trim()) return body.message.trim();
    return "A scan is already in progress for one or more devices.";
  }
  return "Failed to start scan.";
}

export function Dashboard() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { project } = useOutletContext<{ project: ProjectDto | null }>();

  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [lastScanTime, setLastScanTime] = useState<Date>(new Date(0));
  const [scanLoading, setScanLoading] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const [showChecklistDialog, setShowChecklistDialog] = useState(false);
  const [showAlertsDialog, setShowAlertsDialog] = useState(false);

  function loadLastScanTime(pid: string, currentDevices: DeviceDto[]) {
    const lidarDevices = currentDevices.filter((d) => d.Name?.toLowerCase().includes("lidar"));
    if (lidarDevices.length === 0) {
      setLastScanTime(new Date(0));
      return;
    }

    Promise.all(lidarDevices.map((d) => scanApi.getScans(pid, d.Id).catch(() => [] as ScanRecordDto[])))
      .then((groups) => setLastScanTime(computeLastScanTime(groups.flat())))
      .catch(() => setLastScanTime(new Date(0)));
  }

  function loadDashboard() {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    deviceApi
      .getDevicesByProject(projectId)
      .then((fetched) => {
        setDevices(fetched);
        loadLastScanTime(projectId, fetched);
      })
      .catch(() => {
        setDevices([]);
        setError("Failed to load dashboard data.");
      })
      .finally(() => setLoading(false));
  }

  useEffect(loadDashboard, [projectId]);

  const deviceCounts = useMemo<DeviceCounts>(() => computeDeviceCounts(devices), [devices]);
  const alerts = useMemo<DashboardAlert[]>(() => buildAlerts(devices), [devices]);
  const alertCounts = useMemo<AlertCounts>(() => computeAlertCounts(alerts), [alerts]);

  const projectVM = useMemo<ProjectViewModel>(() => {
    const progress = calculateProjectProgress(devices, deviceCounts);
    return {
      title: project?.Title || "Untitled Project",
      description: project?.Description || "No description available.",
      status: getProjectStatus(progress, devices.length > 0),
      progress,
      checklistMessage: getProjectChecklistMessage(devices, deviceCounts),
    };
  }, [project, devices, deviceCounts]);

  function goToDevicesPage() {
    if (projectId) navigate(`/${projectId}/devices`);
  }
  /*
  function goTo3DModelPage() {
    if (projectId) navigate(`/${projectId}/model`);
  }
  */

  async function onRunFullScan() {
    if (!projectId) {
      setScanMessage("No project selected.");
      return;
    }
    
    const lidarDevices = devices.filter((d) => d.Name?.toLowerCase().includes("lidar"));
    if (lidarDevices.length === 0) {
      setScanMessage("No LiDAR devices found for this project.");
      return;
    }

    setScanLoading(true);
    setScanMessage(null);
    try {
      const results = await Promise.all(
        lidarDevices.map((d) => scanApi.startScan(projectId, d.Id, BASE_SCAN_SETTINGS)),
      );
      setScanMessage(`Scan requested for ${results.length} device(s).`);
      setTimeout(() => setScanMessage(null), 5000);
    } catch (err) {
      setScanMessage(getScanStartErrorMessage(err));
    } finally {
      setScanLoading(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-12 gap-6">
        {/*
        <StatsWidget
          project={projectVM}
          deviceCounts={deviceCounts}
          alertCounts={alertCounts}
          onRefresh={loadDashboard}
          onProjectProgressClick={() => setShowChecklistDialog(true)}
          onDevicesClick={goToDevicesPage}
          onAlertsClick={() => setShowAlertsDialog(true)}
        />*/}

        <div className="col-span-12 flex flex-col gap-6 xl:col-span-6">
          <HasPermission permission={Permissions.Project.DevicesRead} projectId={projectId}>
            <DevicesWidget
              devices={devices}
              loading={loading}
              error={error}
              getDeviceStatus={getDeviceStatus}
              getDeviceLastSeen={getDeviceLastSeen}
              onRefresh={loadDashboard}
              onOpenDevicesPage={goToDevicesPage}
            />
          </HasPermission>
          {/* 
          <HasPermission permission={Permissions.Project.ScansRead} projectId={projectId}>
            <ScanStatusWidget
              lastScanTime={lastScanTime}
              formatTimeAgo={formatTimeAgo}
              projectId={projectId}
              scanLoading={scanLoading}
              scanMessage={scanMessage}
              onRefresh={() => projectId && loadLastScanTime(projectId, devices)}
              onOpenModelPage={goTo3DModelPage}
              onRunFullScan={onRunFullScan}
            />
          </HasPermission>          <AlertsWidget
            alerts={alerts}
            alertCounts={alertCounts}
            formatTimeAgo={formatTimeAgo}
            onRefresh={loadDashboard}
            onOpenDevicesPage={goToDevicesPage}
          />
          */}
        </div>

        <div className="col-span-12 flex flex-col gap-6 xl:col-span-6">
          <AlertsWidget
            alerts={alerts}
            alertCounts={alertCounts}
            formatTimeAgo={formatTimeAgo}
            onRefresh={loadDashboard}
            onOpenDevicesPage={goToDevicesPage}
          />
        {/*
         <ProjectChecklistWidget
            project={projectVM}
            deviceCounts={deviceCounts}
            onRefresh={loadDashboard}
            onDevicesAddedClick={goToDevicesPage}
            onOfflineDevicesFixedClick={goToDevicesPage}
            onWarningsResolvedClick={goToDevicesPage}
          />*/}
        </div>
      </div>
      {/*Checklist isnt normally displayed. This can be removed later vvvv*/}
      {showChecklistDialog && (
        <Modal title="Project Checklist" onClose={() => setShowChecklistDialog(false)} widthClassName="max-w-2xl">
          <ProjectChecklistWidget
            project={projectVM}
            deviceCounts={deviceCounts}
            onRefresh={loadDashboard}
            onDevicesAddedClick={() => {
              setShowChecklistDialog(false);
              goToDevicesPage();
            }}
            onOfflineDevicesFixedClick={() => {
              setShowChecklistDialog(false);
              goToDevicesPage();
            }}
            onWarningsResolvedClick={() => {
              setShowChecklistDialog(false);
              goToDevicesPage();
            }}
          />
        </Modal>
      )}

      {showAlertsDialog && (
        <Modal title="Alerts" onClose={() => setShowAlertsDialog(false)} widthClassName="max-w-2xl">
          <AlertsWidget
            alerts={alerts}
            alertCounts={alertCounts}
            formatTimeAgo={formatTimeAgo}
            onRefresh={loadDashboard}
            onOpenDevicesPage={() => {
              setShowAlertsDialog(false);
              goToDevicesPage();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

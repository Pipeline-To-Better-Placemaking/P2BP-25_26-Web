import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { scans } from "../db/schema/index.js";
import * as scanDeviceService from "./scanDeviceService.js";
import type { Scan } from "../models/scanDevice.js";
import type {
  LatestCompleteScan,
  PendingOrRunningScan,
  ScanDto,
  ScanSettingsRequest,
  StartScanResult,
  UpdateScanStatusRequest,
} from "../models/scan.js";

/**
 * Ported from BetterPlacemaking.SERVER/Services/ScanService.cs - this file covers the
 * user-facing methods ScanController calls (CreateScan/GetScans/GetScan/UpdateScanStatus/
 * DeleteScan/HasPendingOrRunningScan/GetLatestCompleteScanForProject). GetNextPendingScanId
 * is the device-facing half and already lives in scanDeviceService.ts (ScanDeviceController's
 * port); GetScan and the core UpdateScanStatus write are delegated to that file below rather
 * than reimplemented, since both controllers operate on the exact same scan rows.
 */

/** Ported from ScanService.NormalizeFirestoreValue - date fields render as ISO-8601 strings, everything else passes through. */
function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Applies normalizeValue across every top-level field, matching GetScan/GetScans's per-field normalization pass. */
function toScanDto(scan: Scan): ScanDto {
  const dto: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(scan)) {
    dto[key] = normalizeValue(value);
  }
  dto.Id = scan.Id;
  return dto as ScanDto;
}

/** Mirrors ScanService.CreateScan: writes the scan doc, stamped with the settings passthrough fields and a JSON snapshot. */
export async function createScan(
  projectId: string,
  deviceId: string,
  settings: ScanSettingsRequest,
  initiatedByUserId?: string | null,
): Promise<StartScanResult> {
  const [row] = await getDb()
    .insert(scans)
    .values({
      projectId,
      deviceId,
      status: "pending",
      createdAt: new Date(),
      initiatedByUserId: initiatedByUserId ?? null,
      extra: JSON.parse(
        JSON.stringify({
          scan_resolution: settings.scan_resolution,
          protocol_mode: settings.protocol_mode,
          orientation_mode: settings.orientation_mode,
          output_mode: settings.output_mode,
          split_mode: settings.split_mode,
          filter_enabled: settings.filter_enabled,
          capture_strategy: settings.capture_strategy,
          min_revolutions_per_slice: settings.min_revolutions_per_slice,
          force_recalibration: settings.force_recalibration,
          ScanSettingsJson: JSON.stringify(settings),
        }),
      ) as Record<string, unknown>,
    })
    .returning({ id: scans.id });

  await requestLidarScanWake(deviceId, settings);

  return { Id: row.id, Status: "pending" };
}

/**
 * TODO(scan-device-wake): stands in for DeviceService.StartLidarScan(deviceId, settings), which
 * wakes the Jetson orchestrator by writing Config.LidarScan.{Enabled,BeginScanning,ScanSettings}
 * on the root devices/{deviceId} doc and invalidating the cached API-key hash. ScanController
 * calls this twice: once from ScanService.CreateScan (new scan) and once directly (see
 * scan.routes.ts) when re-arming an already-pending scan. Not portable without editing
 * deviceService.ts (off-limits here) and adding a LidarScan section to Config in models/device.ts
 * (also off-limits) - the same gap scanDeviceService.ts's updateScanStatus flagged for the
 * mirror-image one-shot clear. Until that lands, a created/re-armed scan sits at
 * status="pending" but the orchestrator is never actually signaled to start scanning.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function requestLidarScanWake(_deviceId: string, _settings: ScanSettingsRequest): Promise<void> {
  // Intentionally a no-op - see the TODO above.
}

/** Mirrors ScanService.HasPendingOrRunningScan. */
export async function hasPendingOrRunningScan(projectId: string, deviceId: string): Promise<PendingOrRunningScan> {
  if (!projectId?.trim() || !deviceId?.trim()) return { exists: false };

  const scans = await getScans(projectId, deviceId);
  for (const scan of scans) {
    const status = typeof scan.Status === "string" ? scan.Status : undefined;
    if (status && (status.toLowerCase() === "pending" || status.toLowerCase() === "running")) {
      return { exists: true, scanId: scan.Id, status };
    }
  }

  return { exists: false };
}

/** Mirrors ScanService.GetScans. */
export async function getScans(projectId: string, deviceId: string): Promise<ScanDto[]> {
  const rows = await getDb()
    .select()
    .from(scans)
    .where(and(eq(scans.projectId, projectId), eq(scans.deviceId, deviceId)));
  return rows.map((row) => toScanDto(scanDeviceService.toScan(row)));
}

/**
 * Mirrors ScanService.GetScan. Delegates to scanDeviceService.getScan (same document, same
 * path) and applies the same NormalizeFirestoreValue pass GetScans uses above - the device-facing
 * port skipped that pass since ScanDeviceController never needed it (see scanDeviceService.ts).
 */
export async function getScan(projectId: string, deviceId: string, scanId: string): Promise<ScanDto | null> {
  const scan = await scanDeviceService.getScan(projectId, deviceId, scanId);
  if (!scan) return null;
  return toScanDto(scan);
}

/** Raw (non-normalized) scan doc, for callers (delete/status-update/xyz/visualizer) that need the underlying Scan rather than the wire DTO. */
export async function getScanRaw(projectId: string, deviceId: string, scanId: string): Promise<Scan | null> {
  return scanDeviceService.getScan(projectId, deviceId, scanId);
}

/**
 * Mirrors ScanService.UpdateScanStatus's Firestore write. Delegates to
 * scanDeviceService.updateScanStatus for the actual field write (Status/ObjUrl/Error plus the
 * StartedAt/FinishedAt transitions) - identical logic, same document - rather than duplicating it.
 *
 * Not ported here (both are out of scope for this resource - see the routes file and the
 * report for detail):
 *  - ScanCompleteVisualizerIngestService.TryIngestFromScanDocumentAsync (visualizer ingest,
 *    triggered by ScanController after every status write)
 *  - NotificationService.NotifyScanCompleted (emails project members on Status=complete)
 *  - DeviceService.ClearLidarScanOneShotIfSet on Status=running - scanDeviceService.ts's own
 *    updateScanStatus already documents this gap; delegating here inherits it.
 */
export async function updateScanStatus(
  projectId: string,
  deviceId: string,
  scanId: string,
  body: UpdateScanStatusRequest,
): Promise<boolean> {
  return scanDeviceService.updateScanStatus(projectId, deviceId, scanId, body);
}

/** Mirrors ScanService.DeleteScan. */
export async function deleteScan(projectId: string, deviceId: string, scanId: string): Promise<boolean> {
  const rows = await getDb()
    .delete(scans)
    .where(and(eq(scans.id, scanId), eq(scans.projectId, projectId), eq(scans.deviceId, deviceId)))
    .returning({ id: scans.id });
  return rows.length > 0;
}

function scanBoolField(scan: Scan, key: string): boolean {
  const camel = key.charAt(0).toLowerCase() + key.slice(1);
  const value = scan[key] ?? scan[camel];
  return typeof value === "boolean" && value;
}

function scanTimestampMillis(scan: Scan, key: string): number | null {
  const camel = key.charAt(0).toLowerCase() + key.slice(1);
  const value = scan[key] ?? scan[camel];
  if (value instanceof Date) return value.getTime();
  return null;
}

/** Mirrors ScanService.IsCalibrationOrCombinedScan - excludes ScanCalibrationController's uploaded/combined scans. */
function isCalibrationOrCombinedScan(scan: Scan): boolean {
  return scanBoolField(scan, "IsUploadedCalibrationScan") || scanBoolField(scan, "IsCombinedCalibrationScan");
}

/** Mirrors ScanService.GetScanFinishedOrCreatedUtc. */
function scanFinishedOrCreatedMillis(scan: Scan): number {
  return scanTimestampMillis(scan, "FinishedAt") ?? scanTimestampMillis(scan, "CreatedAt") ?? Number.NEGATIVE_INFINITY;
}

/** Mirrors ScanService.GetLatestCompleteScanForProject. */
export async function getLatestCompleteScanForProject(
  projectId: string,
  deviceIds: string[],
): Promise<LatestCompleteScan | null> {
  if (!projectId?.trim()) return null;

  let best: (LatestCompleteScan & { sortMillis: number }) | null = null;

  const ids = deviceIds.filter((d) => !!d?.trim());
  if (ids.length === 0) return null;

  // Iterate devices in caller order (ties keep the earlier device, as before).
  const rows = await getDb()
    .select()
    .from(scans)
    .where(and(eq(scans.projectId, projectId), inArray(scans.deviceId, ids)));
  for (const deviceId of ids) {
    for (const row of rows) {
      if (row.deviceId !== deviceId) continue;
      const scan = scanDeviceService.toScan(row);
      const status = typeof scan.Status === "string" ? scan.Status : undefined;
      if (!status || status.toLowerCase() !== "complete") continue;
      if (isCalibrationOrCombinedScan(scan)) continue;

      const sortMillis = scanFinishedOrCreatedMillis(scan);
      if (!best || sortMillis > best.sortMillis) {
        best = { deviceId, scan, sortMillis };
      }
    }
  }

  return best ? { deviceId: best.deviceId, scan: best.scan } : null;
}

/**
 * TODO(scan-visualizer-ingest): stands in for
 * ScanCompleteVisualizerIngestService.TryIngestFromScanDocumentAsync, which
 * ScanController.UpdateScanStatus fires-and-forgets after every successful status write. On the
 * old server it downloads the scan's .xyz (HTTPS ObjUrl with an SSRF host allowlist, or a
 * canonical GCS path) and hot-loads it into the in-memory 3D visualizer session
 * (VisualizerController/XyzParserService/FastMeshService - an entire subsystem with no Express
 * port yet, not just a missing helper). No-op here; the scan's Firestore Status/ObjUrl/Error
 * fields still transition correctly without it (see updateScanStatus above), only the
 * visualizer's live point cloud does not get refreshed automatically.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function tryIngestFromScanDocument(_scan: ScanDto | Scan | null): Promise<void> {
  // Intentionally a no-op - see the TODO above.
}

/**
 * TODO(scan-notifications): stands in for NotificationService.NotifyScanCompleted, which emails
 * the scan's initiating user when its status transitions to "complete". NotificationService has
 * no Express port yet. No-op here; ScanController's caller (see scan.routes.ts) still resolves
 * the same InitiatedByUserId this would have been called with, so wiring in a real
 * notificationService later is a one-line change at that call site.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function notifyScanCompleted(_initiatedByUserId: string, _projectId: string): void {
  // Intentionally a no-op - see the TODO above.
}

/**
 * TODO(scan-xyz-download): stands in for
 * ScanCompleteVisualizerIngestService.DownloadScanXyzAsync, which streams the scan's raw .xyz
 * point cloud (Firestore ObjUrl over HTTPS with an SSRF host allowlist and a size cap, falling
 * back to the canonical GCS object `vision/lidar-scans/{projectId}/{deviceId}/{scanId}.xyz` via
 * CloudStorageService.DownloadToStreamAsync - a method cloudStorageService.ts hasn't ported,
 * which currently only issues signed URLs, not raw downloads). Always returns null (route
 * responds 404 `{ reason: "xyz_unavailable" }`, matching DownloadScanXyz's own "stream is null"
 * branch) until that plumbing exists.
 */
export async function downloadScanXyz(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _deviceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _scan: Scan,
): Promise<Buffer | null> {
  // Intentionally unimplemented - see the TODO above.
  return null;
}

/**
 * TODO(scan-visualizer-ingest): stands in for
 * ScanCompleteVisualizerIngestService.TryIngestCompleteScanForVisualizerAsync, which loads a
 * project's newest complete scan into the in-memory 3D visualizer session (same not-yet-ported
 * subsystem tryIngestFromScanDocument above describes). Always reports the "not implemented"
 * outcome so the route can still surface the honest `{ success:false, reason, message }` shape
 * ScanController.LoadLatestCompleteScanIntoVisualizer returns for its own no-op branches
 * (no_devices/no_complete_scan) - deviceId/scanId resolution (the actually portable half of this
 * endpoint) still runs for real; see scan.routes.ts.
 */
export async function ingestLatestCompleteScanForVisualizer(): Promise<{
  loaded: boolean;
  reason: string;
  message: string;
}> {
  return {
    loaded: false,
    reason: "not_implemented",
    message: "Visualizer ingest (ScanCompleteVisualizerIngestService) has not been ported to this server yet.",
  };
}

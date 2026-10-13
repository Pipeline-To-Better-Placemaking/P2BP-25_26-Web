/**
 * Ported from BetterPlacemaking.SERVER/Controllers/ScanDeviceController.cs and the
 * subset of Services/ScanService.cs it calls (GetNextPendingScanId/GetScan/UpdateScanStatus).
 *
 * Scans live in the `scans` table (formerly Firestore `projects/{projectId}/devices/{deviceId}/scans`) - a
 * separate subtree from the top-level `devices` collection that models/device.ts +
 * services/deviceService.ts manage (device metadata/config/health). Both are keyed by
 * the same device id; the old ScanService reads/writes this subtree directly rather
 * than through DeviceService, so this migration mirrors that same direct access.
 *
 * ScanService.cs treats scan documents as a loose Dictionary<string, object?> - fields
 * beyond the ones ScanDeviceController actually reads/writes (Status/ObjUrl/Error/the
 * timestamps/InitiatedByUserId) are scan-settings passthrough written by
 * ScanController.CreateScan (scan_resolution, protocol_mode, ...), which is a
 * different controller/endpoint not in scope for this port. ScanDoc's index signature
 * preserves those fields on read (stored in the `extra` jsonb column) without needing to model them precisely here.
 */
export interface ScanDoc {
  Status?: string | null;
  CreatedAt?: Date | null;
  StartedAt?: Date | null;
  FinishedAt?: Date | null;
  ObjUrl?: string | null;
  Error?: string | null;
  InitiatedByUserId?: string | null;
  [key: string]: unknown;
}

export interface Scan extends ScanDoc {
  Id: string;
}

/** Body of PATCH /api/scan-device/:scanId/status - mirrors ScanController.UpdateScanStatusRequest. */
export interface UpdateScanStatusRequest {
  Status?: string | null;
  ObjUrl?: string | null;
  Error?: string | null;
}

/** Response body of GET /api/scan-device/next-pending - mirrors ScanDeviceController.GetNextPending's anonymous object. */
export interface NextPendingScanDto {
  ProjectId: string;
  DeviceId: string;
  ScanId: string;
}

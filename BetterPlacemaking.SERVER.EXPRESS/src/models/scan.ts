import type { Scan } from "./scanDevice.js";

/**
 * Ported from BetterPlacemaking.SERVER/Models/ScanSettingsRequest.cs - the body of
 * `POST /api/scan/:projectId/:deviceId` (ScanController.StartScan). Field names are
 * snake_case verbatim (they are the literal C# property names, serialized as-is by
 * System.Text.Json with no naming policy, and mirrored again as literal database
 * field names on the scan document by ScanService.CreateScan).
 */
export interface ScanSettingsRequest {
  scan_resolution?: number;
  protocol_mode?: string | null;
  orientation_mode?: string | null;
  output_mode?: string | null;
  split_mode?: string | null;
  filter_enabled?: boolean;
  capture_strategy?: string | null;
  min_revolutions_per_slice?: number;
  force_recalibration?: boolean;
}

export const AllowedScanResolutions = [1, 8, 16, 32, 64] as const;
export const AllowedProtocolModes = ["legacy", "express", "dense", "ultra"] as const;
export const AllowedOrientationModes = ["table", "ceiling", "wall", "custom"] as const;
export const AllowedOutputModes = ["filtered_only", "raw_only", "raw_and_filtered"] as const;
export const AllowedSplitModes = ["none", "front_back_180"] as const;
export const AllowedCaptureStrategies = ["fixed_time", "min_revolutions", "hybrid"] as const;
export const AllowedMinRevolutionsPerSlice = [1, 2, 3] as const;

/** Ported from ScanSettingsRequest.Validate(). Returns null if valid, a short message otherwise. */
export function validateScanSettings(settings: ScanSettingsRequest): string | null {
  if (settings.scan_resolution === undefined || !AllowedScanResolutions.includes(settings.scan_resolution as any))
    return `scan_resolution must be one of ${AllowedScanResolutions.join(", ")}`;
  if (!settings.protocol_mode || !AllowedProtocolModes.includes(settings.protocol_mode as any))
    return `protocol_mode must be one of ${AllowedProtocolModes.join(", ")}`;
  if (!settings.orientation_mode || !AllowedOrientationModes.includes(settings.orientation_mode as any))
    return `orientation_mode must be one of ${AllowedOrientationModes.join(", ")}`;
  if (!settings.output_mode || !AllowedOutputModes.includes(settings.output_mode as any))
    return `output_mode must be one of ${AllowedOutputModes.join(", ")}`;
  if (!settings.split_mode || !AllowedSplitModes.includes(settings.split_mode as any))
    return `split_mode must be one of ${AllowedSplitModes.join(", ")}`;
  if (!settings.capture_strategy || !AllowedCaptureStrategies.includes(settings.capture_strategy as any))
    return `capture_strategy must be one of ${AllowedCaptureStrategies.join(", ")}`;
  if (
    settings.min_revolutions_per_slice === undefined ||
    !AllowedMinRevolutionsPerSlice.includes(settings.min_revolutions_per_slice as any)
  )
    return `min_revolutions_per_slice must be one of ${AllowedMinRevolutionsPerSlice.join(", ")}`;
  return null;
}

/** Body of PATCH /api/scan/:projectId/:deviceId/:scanId/status - mirrors ScanController's (nested) UpdateScanStatusRequest. */
export interface UpdateScanStatusRequest {
  Status?: string | null;
  ObjUrl?: string | null;
  Error?: string | null;
}

/**
 * Wire shape returned by GetScan/GetScans - mirrors ScanService's NormalizeValue
 * pass: every Timestamp field is rendered as an ISO-8601 string (`.ToString("o")`)
 * rather than the raw Timestamp, and all other fields (including the
 * ScanSettingsRequest passthrough fields written by CreateScan) pass through unchanged.
 */
export type ScanDto = Record<string, unknown> & { Id: string };

/** Result of ScanController.StartScan - mirrors CreateScan's anonymous `{ Id, Status }` and the re-arm-pending-scan branch's `{ Id = existing.ScanId, Status = existing.Status }`. */
export interface StartScanResult {
  Id: string;
  Status: string | null;
}

/** Mirrors ScanService.HasPendingOrRunningScan's tuple return. */
export interface PendingOrRunningScan {
  exists: boolean;
  scanId?: string;
  status?: string;
}

/** Mirrors ScanService.GetLatestCompleteScanForProject's `(DeviceId, Scan)?` return. */
export interface LatestCompleteScan {
  deviceId: string;
  scan: Scan;
}

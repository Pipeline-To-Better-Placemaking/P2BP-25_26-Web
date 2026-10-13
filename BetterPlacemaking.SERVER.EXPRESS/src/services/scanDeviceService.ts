import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { scans } from "../db/schema/index.js";
import type { Scan, UpdateScanStatusRequest } from "../models/scanDevice.js";

/**
 * Mirrors ScanService.cs's data model: scans belong to a (project, device) pair (formerly the
 * database subcollection `projects/{projectId}/devices/{deviceId}/scans`), distinct from the
 * top-level `devices` table deviceService.ts owns. Kept as a direct table access here (not
 * routed through deviceService.ts) for the same reason ScanService.cs talks to database
 * directly instead of going through DeviceService for this subtree.
 */
export type ScanRow = typeof scans.$inferSelect;

/** Row -> API-shaped scan: first-class columns plus the passthrough `extra` fields, PascalCase as before. */
export function toScan(row: ScanRow): Scan {
  return {
    ...(row.extra ?? {}),
    Id: row.id,
    Status: row.status,
    CreatedAt: row.createdAt,
    StartedAt: row.startedAt,
    FinishedAt: row.finishedAt,
    ObjUrl: row.objUrl,
    Error: row.error,
    InitiatedByUserId: row.initiatedByUserId,
  };
}

/** Oldest pending scan for the device, or null if none. Mirrors ScanService.GetNextPendingScanId. */
export async function getNextPendingScanId(projectId: string, deviceId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: scans.id })
    .from(scans)
    .where(
      and(
        eq(scans.projectId, projectId),
        eq(scans.deviceId, deviceId),
        sql`lower(trim(${scans.status})) = 'pending'`,
      ),
    )
    .orderBy(asc(scans.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Mirrors ScanService.GetScan, minus the NormalizeValue timestamp->ISO-string pass (not needed by ScanDeviceController's own use of this). */
export async function getScan(projectId: string, deviceId: string, scanId: string): Promise<Scan | null> {
  const [row] = await getDb()
    .select()
    .from(scans)
    .where(and(eq(scans.id, scanId), eq(scans.projectId, projectId), eq(scans.deviceId, deviceId)))
    .limit(1);
  return row ? toScan(row) : null;
}

/**
 * Mirrors ScanService.UpdateScanStatus: only the provided fields are written, plus
 * server-assigned StartedAt/FinishedAt transitions.
 *
 * Not ported (out of scope for this resource - both are separate, not-yet-migrated
 * services with no Express equivalent yet):
 *  - ScanCompleteVisualizerIngestService.TryIngestFromScanDocumentAsync (visualizer ingest
 *    pipeline triggered after every status write)
 *  - NotificationService.NotifyScanCompleted (emails project members on Status=complete)
 *  - DeviceService.ClearLidarScanOneShotIfSet (best-effort Config.LidarScan.BeginScanning
 *    clear on Status=running; the ported Config type in models/device.ts has no LidarScan
 *    field yet). This is a self-healing performance optimization on the old server, not a
 *    correctness requirement - see the comment in ScanService.cs's UpdateScanStatus.
 */
export async function updateScanStatus(
  projectId: string,
  deviceId: string,
  scanId: string,
  body: UpdateScanStatusRequest,
): Promise<boolean> {
  const status = body.Status?.trim();
  const objUrl = body.ObjUrl?.trim();
  const error = body.Error?.trim();

  const updates: Partial<typeof scans.$inferInsert> = {};
  if (status) updates.status = status;
  if (objUrl) updates.objUrl = objUrl;
  if (error) updates.error = error;

  if (status && status.toLowerCase() === "running") {
    updates.startedAt = new Date();
  }
  if (status && (status.toLowerCase() === "complete" || status.toLowerCase() === "error")) {
    updates.finishedAt = new Date();
  }

  const where = and(eq(scans.id, scanId), eq(scans.projectId, projectId), eq(scans.deviceId, deviceId));
  if (Object.keys(updates).length === 0) {
    const [existing] = await getDb().select({ id: scans.id }).from(scans).where(where).limit(1);
    return !!existing;
  }

  const rows = await getDb().update(scans).set(updates).where(where).returning({ id: scans.id });
  return rows.length > 0;
}

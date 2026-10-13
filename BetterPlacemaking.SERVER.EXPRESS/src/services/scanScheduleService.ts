import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { scanSchedules } from "../db/schema/index.js";
import type { ScanSchedule } from "../models/scanSchedule.js";

function toScanSchedule(row: typeof scanSchedules.$inferSelect): ScanSchedule {
  return {
    Id: row.id,
    StartDate: row.startDate,
    StartTime: row.startTime,
    Frequency: row.frequency,
    EndDate: row.endDate,
    EndTime: row.endTime,
    CreatedAt: row.createdAt,
    CreatedByUserId: row.createdByUserId,
    LastRunAt: row.lastRunAt,
  };
}

export interface ScanScheduleCreateInput {
  StartDate?: string | null;
  StartTime?: string | null;
  Frequency?: string | null;
  EndDate?: string | null;
  EndTime?: string | null;
  LastRunAt?: Date | string | null;
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Mirrors ScanScheduleService.CreateSchedule: CreatedAt/CreatedByUserId are always server-assigned, never client-supplied. */
export async function createSchedule(
  projectId: string,
  input: ScanScheduleCreateInput,
  createdByUserId?: string | null,
): Promise<ScanSchedule> {
  const [row] = await getDb()
    .insert(scanSchedules)
    .values({
      projectId,
      startDate: input.StartDate ?? null,
      startTime: input.StartTime ?? null,
      frequency: input.Frequency ?? null,
      endDate: input.EndDate ?? null,
      endTime: input.EndTime ?? null,
      createdAt: new Date(),
      createdByUserId: createdByUserId ?? null,
      lastRunAt: toDateOrNull(input.LastRunAt),
    })
    .returning();
  return toScanSchedule(row);
}

export async function getSchedules(projectId: string): Promise<ScanSchedule[]> {
  const rows = await getDb().select().from(scanSchedules).where(eq(scanSchedules.projectId, projectId));
  return rows.map(toScanSchedule);
}

export async function deleteSchedule(projectId: string, scheduleId: string): Promise<boolean> {
  const rows = await getDb()
    .delete(scanSchedules)
    .where(and(eq(scanSchedules.id, scheduleId), eq(scanSchedules.projectId, projectId)))
    .returning({ id: scanSchedules.id });
  return rows.length > 0;
}

export interface ScanScheduleUpdateInput {
  StartDate?: string | null;
  StartTime?: string | null;
  Frequency?: string | null;
  EndDate?: string | null;
  EndTime?: string | null;
}

/**
 * Mirrors ScanScheduleService.UpdateSchedule's partial-update semantics exactly:
 * StartDate/StartTime/Frequency are only touched when provided (omitting one leaves
 * the stored value unchanged), while EndDate/EndTime are *always* written, defaulting
 * to "" when omitted - ported faithfully even though this asymmetry looks like it lets
 * a caller inadvertently clear an end date/time by leaving it out of the request body.
 */
export async function updateSchedule(
  projectId: string,
  scheduleId: string,
  input: ScanScheduleUpdateInput,
): Promise<boolean> {
  const updates: Partial<typeof scanSchedules.$inferInsert> = {
    endDate: input.EndDate ?? "",
    endTime: input.EndTime ?? "",
  };
  if (input.StartDate != null) updates.startDate = input.StartDate;
  if (input.StartTime != null) updates.startTime = input.StartTime;
  if (input.Frequency != null) updates.frequency = input.Frequency;

  const rows = await getDb()
    .update(scanSchedules)
    .set(updates)
    .where(and(eq(scanSchedules.id, scheduleId), eq(scanSchedules.projectId, projectId)))
    .returning({ id: scanSchedules.id });
  return rows.length > 0;
}

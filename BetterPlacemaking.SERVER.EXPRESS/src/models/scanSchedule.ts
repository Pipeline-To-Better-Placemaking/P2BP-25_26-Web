/**
 * Row shape for the `scan_schedules` table (formerly the `projects/{projectId}/scan_schedules` subcollection),
 * ported field-for-field (PascalCase) from Models/ScanSchedule.cs. CRUD/config only -
 * the actual scan-triggering logic lives in ScanScheduleExecutorService, which is a
 * background job runner (no HTTP surface of its own) being ported separately later.
 */
export interface ScanScheduleDoc {
  StartDate?: string | null;
  StartTime?: string | null;
  Frequency?: string | null;
  EndDate?: string | null;
  EndTime?: string | null;
  CreatedAt: Date;
  CreatedByUserId?: string | null;
  LastRunAt?: Date | null;
}

export interface ScanSchedule extends ScanScheduleDoc {
  Id: string;
}

/** Wire DTO - ScanScheduleController.GetAll/Create return the schedule as-is, so this mirrors ScanSchedule directly. */
export interface ScanScheduleDto {
  Id?: string;
  StartDate?: string | null;
  StartTime?: string | null;
  Frequency?: string | null;
  EndDate?: string | null;
  EndTime?: string | null;
  CreatedAt?: Date | null;
  CreatedByUserId?: string | null;
  LastRunAt?: Date | null;
}

export function toScanScheduleDto(schedule: ScanSchedule): ScanScheduleDto {
  return {
    Id: schedule.Id,
    StartDate: schedule.StartDate ?? null,
    StartTime: schedule.StartTime ?? null,
    Frequency: schedule.Frequency ?? null,
    EndDate: schedule.EndDate ?? null,
    EndTime: schedule.EndTime ?? null,
    CreatedAt: schedule.CreatedAt ?? null,
    CreatedByUserId: schedule.CreatedByUserId ?? null,
    LastRunAt: schedule.LastRunAt ?? null,
  };
}

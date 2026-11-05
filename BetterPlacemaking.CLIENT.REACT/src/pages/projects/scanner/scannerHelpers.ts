import type { DeviceDto } from "../../../lib/deviceTypes";
import type {
  CaptureStrategy,
  OrientationMode,
  OutputMode,
  ProtocolMode,
  ScanPreset,
  ScanRecordDto,
  ScanResolution,
  ScanScheduleDto,
  SplitMode,
} from "../../../lib/scanTypes";

/**
 * Shared constants/formatters for the Scanner page and its scanner/ subcomponents. Ported from
 * BetterPlacemaking.CLIENT/src/app/views/admin/devices/scanner/scanner.ts - option lists,
 * status label/severity mapping, and the date-formatting helpers used across the settings,
 * schedule, and history panels.
 */

export interface FrequencyOption {
  name: string;
  code: string;
}

export interface SelectOption<T> {
  label: string;
  value: T;
}

export const FREQUENCY_OPTIONS: FrequencyOption[] = [
  { name: "Never", code: "Never" },
  { name: "Weekly", code: "Weekly" },
  { name: "Monthly", code: "Monthly" },
  { name: "Yearly", code: "Yearly" },
];

export const PRESET_OPTIONS: SelectOption<ScanPreset>[] = [
  { label: "Base Quality", value: "base" },
  { label: "Medium Quality", value: "medium" },
  { label: "High Quality", value: "high" },
];

export const SCAN_RESOLUTION_OPTIONS: SelectOption<ScanResolution>[] = [
  { label: "1 — 1.0° per slice", value: 1 },
  { label: "8 — 0.125° per slice", value: 8 },
  { label: "16 — 0.0625° per slice", value: 16 },
  { label: "32 — 0.03125° per slice", value: 32 },
  { label: "64 — 0.0156° per slice", value: 64 },
];

export const PROTOCOL_MODE_OPTIONS: SelectOption<ProtocolMode>[] = [
  { label: "Legacy", value: "legacy" },
  { label: "Express (For upgraded LiDAR only)", value: "express" },
  { label: "Dense (For upgraded LiDAR only)", value: "dense" },
  { label: "Ultra (For upgraded LiDAR only)", value: "ultra" },
];

export const ORIENTATION_MODE_OPTIONS: SelectOption<OrientationMode>[] = [
  { label: "Table (Right Side Up)", value: "table" },
  { label: "Ceiling (Upside Down Up)", value: "ceiling" },
  { label: "Wall", value: "wall" },
  { label: "Custom", value: "custom" },
];

export const OUTPUT_MODE_OPTIONS: SelectOption<OutputMode>[] = [
  { label: "Filtered Only", value: "filtered_only" },
  { label: "Raw Only", value: "raw_only" },
  { label: "Raw and Filtered", value: "raw_and_filtered" },
];

export const SPLIT_MODE_OPTIONS: SelectOption<SplitMode>[] = [
  { label: "None", value: "none" },
  { label: "Front / Back 180°", value: "front_back_180" },
];

export const CAPTURE_STRATEGY_OPTIONS: SelectOption<CaptureStrategy>[] = [
  { label: "Fixed Time", value: "fixed_time" },
  { label: "Minimum Revolutions", value: "min_revolutions" },
  { label: "Hybrid", value: "hybrid" },
];

export const MIN_REVOLUTION_OPTIONS: SelectOption<1 | 2 | 3>[] = [
  { label: "1 revolution", value: 1 },
  { label: "2 revolutions", value: 2 },
  { label: "3 revolutions", value: 3 },
];

export type StatusSeverity = "success" | "info" | "warn" | "error" | "secondary";

export function getScanStatusLabel(status: string | null | undefined): string {
  switch ((status ?? "").toLowerCase()) {
    case "pending":
      return "Queued";
    case "calibrating":
      return "Calibrating";
    case "running":
    case "in_progress":
      return "Scan in progress";
    case "complete":
    case "done":
      return "Done";
    case "error":
    case "failed":
      return "Failed";
    default:
      return status ?? "Unknown";
  }
}

export function getScanStatusSeverity(status: string | null | undefined): StatusSeverity {
  switch ((status ?? "").toLowerCase()) {
    case "pending":
    case "calibrating":
      return "warn";
    case "running":
    case "in_progress":
      return "info";
    case "complete":
    case "done":
      return "success";
    case "error":
    case "failed":
      return "error";
    default:
      return "secondary";
  }
}

/** Tailwind classes for a status pill, keyed the same way as getScanStatusSeverity. */
export const STATUS_BADGE_CLASS: Record<StatusSeverity, string> = {
  success: "bg-green-50 text-green-700",
  info: "bg-brand-50 text-brand-700",
  warn: "bg-amber-50 text-amber-700",
  error: "bg-red-50 text-red-700",
  secondary: "bg-neutral-100 text-neutral-600",
};

/** M/D/YYYY H:MM:SS AM/PM, en-US locale. Used by scan history and schedule tables for visual consistency. */
export function formatScanDateTime(value: unknown): string {
  if (!value) return "-";

  let date: Date | null = null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  } else if (value && typeof value === "object" && "seconds" in value) {
    const seconds = (value as { seconds?: number }).seconds;
    if (typeof seconds === "number") date = new Date(seconds * 1000);
  }

  return date ? formatUsSlashesSeconds(date) : typeof value === "string" ? value : "-";
}

/** Display-only: combine ScanSchedule's "yyyy-MM-dd" + "HH:mm" strings in the same M/D/YYYY H:MM:SS AM/PM format. */
export function formatScheduleDateTime(dateStr?: string | null, timeStr?: string | null): string {
  if (!dateStr || !timeStr) return "-";
  const parsed = new Date(`${dateStr}T${timeStr}`);
  return Number.isNaN(parsed.getTime()) ? `${dateStr} ${timeStr}` : formatUsSlashesSeconds(parsed);
}

export function formatLastRunAt(value: unknown): string {
  if (value == null) return "—";
  let ms = 0;
  if (typeof value === "number") {
    ms = value < 1e12 ? value * 1000 : value;
  } else if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return "—";
    ms = parsed;
  } else if (typeof value === "object") {
    const s = (value as { seconds?: number; _seconds?: number }).seconds ?? (value as { _seconds?: number })._seconds;
    if (typeof s === "number") ms = s * 1000;
  }
  return ms > 0 ? formatUsSlashesSeconds(new Date(ms)) : "—";
}

export function getScheduleFrequencyName(code: string): string {
  const freq = FREQUENCY_OPTIONS.find((f) => f.code === code);
  return freq ? freq.name : code;
}

export function isLidarConnected(device: DeviceDto | null | undefined): boolean {
  const lidars = device?.HealthReport?.Lidars;
  if (!lidars) return false;
  const first = Object.values(lidars)[0];
  return first?.Connected === true;
}

function getSortTimestamp(scan: ScanRecordDto): number {
  const raw = scan?.CreatedAt ?? scan?.StartedAt ?? scan?.FinishedAt;
  if (!raw) return 0;

  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (raw && typeof raw === "object" && "seconds" in raw) {
    const seconds = (raw as { seconds?: number }).seconds;
    if (typeof seconds === "number") return seconds * 1000;
  }

  return 0;
}

export function sortScansNewestFirst(scans: ScanRecordDto[]): ScanRecordDto[] {
  return [...scans].sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a));
}

export function getLatestScan(scans: ScanRecordDto[]): ScanRecordDto | undefined {
  return sortScansNewestFirst(scans)[0];
}

/** Explicit en-US: M/D/YYYY H:MM:SS AM/PM, space between date and time. */
function formatUsSlashesSeconds(date: Date): string {
  return `${date.toLocaleDateString("en-US")} ${date.toLocaleTimeString("en-US")}`;
}

/** yyyy-MM-dd, local time. */
export function formatDatePart(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** HH:mm, local time (24h, matches a native <input type="time"> value). */
export function formatTimePart(value: Date): string {
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function combineDateAndTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}`);
}

/** Parses ScanScheduleDto's "yyyy-MM-dd" + "HH:mm" (or "HH:mm:ss"/12h "h:mm AM/PM") into a Date, or null if either part is missing/invalid. */
export function parseScheduleDateTime(date?: string | null, time?: string | null): Date | null {
  if (!date || !time) return null;

  const normalizedTime = normalizeScheduleTime(time);
  if (!normalizedTime) return null;

  const parsed = new Date(`${date}T${normalizedTime}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeScheduleTime(time: string): string | null {
  const trimmed = time.trim();

  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  const meridian = match[4]?.toUpperCase();

  if (meridian === "PM" && hour < 12) hour += 12;
  if (meridian === "AM" && hour === 12) hour = 0;

  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:${second.toString().padStart(2, "0")}`;
}

export function getScheduleLastRunMs(value: unknown): number {
  if (!value) return 0;

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (typeof value === "object") {
    const s = (value as { seconds?: number; _seconds?: number }).seconds ?? (value as { _seconds?: number })._seconds;
    if (typeof s === "number") return s * 1000;
  }

  return 0;
}

/** Ported from Scanner.isScheduleDue/getCurrentOccurrenceForSchedule/isWithinDueWindow: is `schedule` due to run at `now`? `pollMs` is the schedule-watcher's poll interval, used as the "due window" tolerance. */
export function isScheduleDue(schedule: ScanScheduleDto, now: Date, pollMs: number): boolean {
  const start = parseScheduleDateTime(schedule.StartDate, schedule.StartTime);
  if (!start) return false;

  const end = parseScheduleDateTime(schedule.EndDate, schedule.EndTime);
  if (now < start) return false;
  if (end && now > end) return false;

  const lastRunMs = getScheduleLastRunMs(schedule.LastRunAt);

  // Prevent duplicate triggering within the same minute.
  if (lastRunMs && now.getTime() - lastRunMs < 60_000) {
    return false;
  }

  const frequency = schedule.Frequency;

  if (frequency === "Never") {
    return !lastRunMs && isWithinDueWindow(now, start, pollMs);
  }

  const occurrence = getCurrentOccurrenceForSchedule(schedule, now);
  if (!occurrence) return false;

  if (!isWithinDueWindow(now, occurrence, pollMs)) {
    return false;
  }

  if (lastRunMs && lastRunMs >= occurrence.getTime()) {
    return false;
  }

  return true;
}

function getCurrentOccurrenceForSchedule(schedule: ScanScheduleDto, now: Date): Date | null {
  const start = parseScheduleDateTime(schedule.StartDate, schedule.StartTime);
  if (!start) return null;

  const occurrence = new Date(now);
  occurrence.setHours(start.getHours(), start.getMinutes(), 0, 0);

  switch (schedule.Frequency) {
    case "Daily":
      return occurrence;

    case "Weekly":
      return now.getDay() === start.getDay() ? occurrence : null;

    case "Monthly":
      return now.getDate() === start.getDate() ? occurrence : null;

    case "Yearly":
      return now.getMonth() === start.getMonth() && now.getDate() === start.getDate() ? occurrence : null;

    default:
      return null;
  }
}

function isWithinDueWindow(now: Date, target: Date, pollMs: number): boolean {
  const diff = Math.abs(now.getTime() - target.getTime());
  return diff <= pollMs;
}

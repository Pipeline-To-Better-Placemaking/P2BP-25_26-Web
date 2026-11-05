import { HasPermission } from "../../../auth/HasPermission";
import { Permissions } from "../../../lib/permissions";
import type { ScanScheduleDto } from "../../../lib/scanTypes";
import { FREQUENCY_OPTIONS, type FrequencyOption, formatLastRunAt, formatScheduleDateTime, getScheduleFrequencyName } from "./scannerHelpers";

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-ink focus:border-brand-500 focus:outline-none";
const labelClass = "text-xs font-medium text-ink-muted";
const btnPrimary =
  "rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-50";
const btnIcon = "rounded-md p-1.5 text-ink-muted hover:bg-slate-100 disabled:opacity-50";

interface ScanSchedulePanelProps {
  projectId: string | undefined;
  schedules: ScanScheduleDto[];
  scheduledDateTime: string;
  endDateTime: string;
  selectedFrequency: FrequencyOption | undefined;
  editingScheduleId: string | null;
  scheduleMessage: string | null;
  onScheduledDateTimeChange: (value: string) => void;
  onEndDateTimeChange: (value: string) => void;
  onFrequencyChange: (freq: FrequencyOption | undefined) => void;
  onSubmit: () => void;
  onEdit: (schedule: ScanScheduleDto) => void;
  onCancel: (id: string) => void;
}

/** The "Scan Scheduling" card - create/edit/list recurring scan jobs. Ported from scanner.html's scheduling section. */
export function ScanSchedulePanel({
  projectId,
  schedules,
  scheduledDateTime,
  endDateTime,
  selectedFrequency,
  editingScheduleId,
  scheduleMessage,
  onScheduledDateTimeChange,
  onEndDateTimeChange,
  onFrequencyChange,
  onSubmit,
  onEdit,
  onCancel,
}: ScanSchedulePanelProps) {
  const isRecurring = !!selectedFrequency && selectedFrequency.code !== "Never";
  const isErrorMessage =
    !!scheduleMessage && (scheduleMessage.includes("Please") || scheduleMessage.includes("must"));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Start Date & Time</span>
          <input
            type="datetime-local"
            className={inputClass}
            value={scheduledDateTime}
            onChange={(e) => onScheduledDateTimeChange(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Frequency</span>
          <select
            className={inputClass}
            value={selectedFrequency?.code ?? ""}
            onChange={(e) => onFrequencyChange(FREQUENCY_OPTIONS.find((f) => f.code === e.target.value))}
          >
            <option value="" disabled>
              Select Frequency
            </option>
            {FREQUENCY_OPTIONS.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
              </option>
            ))}
          </select>
        </label>

        {isRecurring && (
          <label className="flex flex-col gap-1">
            <span className={labelClass}>End Date & Time</span>
            <input
              type="datetime-local"
              className={inputClass}
              min={scheduledDateTime || undefined}
              value={endDateTime}
              onChange={(e) => onEndDateTimeChange(e.target.value)}
            />
          </label>
        )}
      </div>

      <div>
        <HasPermission permission={Permissions.Project.ScanSchedulesManage} projectId={projectId}>
          <button type="button" onClick={onSubmit} className={btnPrimary}>
            {editingScheduleId ? "Update Schedule" : "Schedule Scan"}
          </button>
        </HasPermission>
      </div>

      {scheduleMessage && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            isErrorMessage ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
          }`}
        >
          {scheduleMessage}
        </p>
      )}

      {schedules.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-mauve text-left text-white">
              <tr>
                <th className="px-3 py-2 font-medium">Start Date & Time</th>
                <th className="px-3 py-2 font-medium">Frequency</th>
                <th className="px-3 py-2 font-medium">End Date & Time</th>
                <th className="px-3 py-2 font-medium">Last Run</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.Id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">{formatScheduleDateTime(s.StartDate, s.StartTime)}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-ink-muted">
                      {getScheduleFrequencyName(s.Frequency)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{s.EndDate ? formatScheduleDateTime(s.EndDate, s.EndTime) : "-"}</td>
                  <td className="px-3 py-2">{formatLastRunAt(s.LastRunAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <HasPermission permission={Permissions.Project.ScanSchedulesManage} projectId={projectId}>
                        <button type="button" onClick={() => onEdit(s)} title="Edit" className={btnIcon}>
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => s.Id && onCancel(s.Id)}
                          title="Delete"
                          className={`${btnIcon} text-red-600 hover:bg-red-50`}
                        >
                          ✕
                        </button>
                      </HasPermission>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

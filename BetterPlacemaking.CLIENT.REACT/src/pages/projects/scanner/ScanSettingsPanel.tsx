import type {
  CaptureStrategy,
  OrientationMode,
  OutputMode,
  ProtocolMode,
  ScanPreset,
  ScanResolution,
  ScanSettingsRequest,
  SplitMode,
} from "../../../lib/scanTypes";
import {
  CAPTURE_STRATEGY_OPTIONS,
  MIN_REVOLUTION_OPTIONS,
  ORIENTATION_MODE_OPTIONS,
  OUTPUT_MODE_OPTIONS,
  PRESET_OPTIONS,
  PROTOCOL_MODE_OPTIONS,
  SCAN_RESOLUTION_OPTIONS,
  SPLIT_MODE_OPTIONS,
} from "./scannerHelpers";

const selectClass =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-ink focus:border-brand-500 focus:outline-none";
const labelClass = "text-xs font-medium text-ink-muted";

interface ScanSettingsPanelProps {
  scanSettings: ScanSettingsRequest;
  selectedPreset: ScanPreset | null;
  onApplyPreset: (preset: ScanPreset) => void;
  onSettingChange: <K extends keyof ScanSettingsRequest>(key: K, value: ScanSettingsRequest[K]) => void;
}

/**
 * The "Scan Settings" card - preset picker plus every individual ScanSettingsRequest field.
 * Ported from scanner.html's `fusion-settings-grid` section. Picking any individual field
 * (rather than a preset) clears `selectedPreset` back to null, matching the old
 * `onScanSettingChanged` behavior.
 */
export function ScanSettingsPanel({ scanSettings, selectedPreset, onApplyPreset, onSettingChange }: ScanSettingsPanelProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Preset</span>
        <select
          className={selectClass}
          value={selectedPreset ?? ""}
          onChange={(e) => onApplyPreset(e.target.value as ScanPreset)}
        >
          <option value="" disabled>
            Select preset
          </option>
          {PRESET_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Scan Resolution</span>
        <select
          className={selectClass}
          value={scanSettings.scan_resolution}
          onChange={(e) => onSettingChange("scan_resolution", Number(e.target.value) as ScanResolution)}
        >
          {SCAN_RESOLUTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Protocol Mode</span>
        <select
          className={selectClass}
          value={scanSettings.protocol_mode}
          onChange={(e) => onSettingChange("protocol_mode", e.target.value as ProtocolMode)}
        >
          {PROTOCOL_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Orientation Mode</span>
        <select
          className={selectClass}
          value={scanSettings.orientation_mode}
          onChange={(e) => onSettingChange("orientation_mode", e.target.value as OrientationMode)}
        >
          {ORIENTATION_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {scanSettings.orientation_mode === "custom" && (
          <span className="text-xs text-amber-600">
            Custom orientation is selectable, but extra axis controls may still depend on backend support.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Output Mode</span>
        <select
          className={selectClass}
          value={scanSettings.output_mode}
          onChange={(e) => onSettingChange("output_mode", e.target.value as OutputMode)}
        >
          {OUTPUT_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Split Mode</span>
        <select
          className={selectClass}
          value={scanSettings.split_mode}
          onChange={(e) => onSettingChange("split_mode", e.target.value as SplitMode)}
        >
          {SPLIT_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Capture Strategy</span>
        <select
          className={selectClass}
          value={scanSettings.capture_strategy}
          onChange={(e) => onSettingChange("capture_strategy", e.target.value as CaptureStrategy)}
        >
          {CAPTURE_STRATEGY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Minimum Revolutions</span>
        <select
          className={selectClass}
          value={scanSettings.min_revolutions_per_slice}
          onChange={(e) => onSettingChange("min_revolutions_per_slice", Number(e.target.value) as 1 | 2 | 3)}
        >
          {MIN_REVOLUTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
        <span className={labelClass}>Distance Filtering</span>
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={scanSettings.filter_enabled}
          onChange={(e) => onSettingChange("filter_enabled", e.target.checked)}
        />
      </label>

      <label className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
        <span className={labelClass}>Recalibrate Before Scan</span>
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={scanSettings.force_recalibration}
          onChange={(e) => onSettingChange("force_recalibration", e.target.checked)}
        />
      </label>
    </div>
  );
}

import { useRef } from "react";
import { PRIMARY_BUTTON } from "../../../components/buttonStyles";
import Dropdown from "./Dropdown";

const DROP_ZONE =
  "mt-4 flex min-h-64 flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center dark:border-surface-600 dark:bg-surface-800";

function CloudUploadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted" aria-hidden="true">
      <path d="M12 13v8" />
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="m8 17 4-4 4 4" />
    </svg>
  );
}

export function UploadDataPanel() {
  const floorPlanInputRef = useRef<HTMLInputElement>(null);
  const trackingDataInputRef = useRef<HTMLInputElement>(null);

  const dropdownOptions = [
    { label: "Meters (M)", value: "meters" },
    { label: "Millimeters (mm)", value: "millimeters" },
  ];

  const handleSelect = (selected: { label: string; value: string }) => {
    console.log("Selected:", selected);
  };

  return (
    <div className="bp-card flex-1 p-6">
      <h2 className="text-xl font-semibold text-ink">Upload Floor Plan & Tracking Data</h2>
      <p className="mt-1 text-sm text-ink-muted">Add floor plan and tracking data files to visualize the scanned environment.</p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* floor plan input */}
        <div className="rounded-lg border border-slate-200 p-5 dark:border-surface-700">
          <h3 className="font-semibold text-ink">Floor Plan File</h3>
          <p className="mt-1 text-sm text-ink-muted">Select a floor plan image or file (e.g. PDF, PNG, JPG).</p>

          <div className={DROP_ZONE}>
            <CloudUploadIcon />
            <p className="mt-4 text-sm text-ink-muted">Select a floor plan file</p>
            <p className="mt-1 text-sm text-ink-muted">DWG, RTV, etc...</p>

            <input ref={floorPlanInputRef} type="file" accept=".dwg,.rvt" className="hidden" aria-label="Choose floor plan file" />
            <button type="button" onClick={() => floorPlanInputRef.current?.click()} className={`mt-4 ${PRIMARY_BUTTON}`}>
              Choose File
            </button>
          </div>
        </div>

        {/* tracking data input */}
        <div className="rounded-lg border border-slate-200 p-5 dark:border-surface-700">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-ink">Tracking Data</h3>
              <p className="mt-1 text-sm text-ink-muted">Select a tracking data file (.xyz, .obj...)</p>
            </div>
            <Dropdown label="" options={dropdownOptions} onSelect={handleSelect} placeholder="Choose tracking unit" />
          </div>

          <div className={DROP_ZONE}>
            <CloudUploadIcon />
            <p className="mt-4 text-sm text-ink-muted">Select a tracking data file</p>
            <p className="mt-1 text-sm text-ink-muted">XYZ, OBJ, PLY, etc...</p>

            <input ref={trackingDataInputRef} type="file" accept=".xyz,.obj,.ply" className="hidden" aria-label="Choose tracking data file" />
            <button type="button" onClick={() => trackingDataInputRef.current?.click()} className={`mt-4 ${PRIMARY_BUTTON}`}>
              Choose File
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button type="button" className={PRIMARY_BUTTON}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="m17 8-5-5-5 5" />
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          </svg>
          Upload
        </button>
      </div>
    </div>
  );
}

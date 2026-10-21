import { useState } from "react";
import { ScanVisualPanel, type ScannerVisualMode } from "./scanner/ScanVisualPanel";

/**
  * Floor plan page. Archived old version of the page in ScannerArchive.tsx, which is not referenced or implemented anywhere
*/
export function Scanner() {
  const [visualMode, setVisualMode] = useState<ScannerVisualMode>("solids");

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Floor Plan & Tracking</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Upload floor plans & tracking data to view the 2D/3D visualizations
          </p>
        </div>
      </div>

      <ScanVisualPanel
        visualMode={visualMode}
        onVisualModeChange={setVisualMode}
      />
    </div>
  );
}

import { PageHeader } from "../../components/PageHeader";
import { useState } from "react";
import { ScanVisualPanel, type ScannerVisualMode } from "./scanner/ScanVisualPanel";

/**
  * Floor plan page. Archived old version of the page in ScannerArchive.tsx, which is not referenced or implemented anywhere
*/
export function Scanner() {
  const [visualMode, setVisualMode] = useState<ScannerVisualMode>("solids");

  return (
    <div>
      <PageHeader
        title="Floor Plan & Tracking"
        subtitle="Upload floor plans & tracking data to view the 2D/3D visualizations"
      />

      <ScanVisualPanel
        visualMode={visualMode}
        onVisualModeChange={setVisualMode}
      />
    </div>
  );
}

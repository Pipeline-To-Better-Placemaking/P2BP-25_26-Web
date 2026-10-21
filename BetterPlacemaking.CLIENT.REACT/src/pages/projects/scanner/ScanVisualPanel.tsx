import { useRef, useState } from "react";
import { PointCloudViewer, type PointCloudViewerHandle } from "../../../components/PointCloudViewer";
import { SolidObjectsView, type SolidObjectsViewHandle } from "../../../components/SolidObjectsView";
import { UploadDataPanel } from "./UploadDataPanel";

export type ScannerVisualMode = "3d" | "solids";

const tabBtn = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${
    active ? "bg-indigo-600 text-white" : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
  }`;

interface ScanVisualPanelProps {
  visualMode: ScannerVisualMode;
  onVisualModeChange: (mode: ScannerVisualMode) => void;
}

/**
 * The bottom "2D View" / "3D View" toggle - renders SolidObjectsView (labeled "2D View", matching
 * the old Angular template's label despite the component itself being a 3D orbit scene) and
 * PointCloudViewer (labeled "3D View").
 *
 * Neither raw lidar point-cloud bytes nor detected-object clusters have a real data source yet:
 * Rplidar (the raw point-cloud pipeline) and the in-memory Visualizer/mesh subsystem have not
 * been ported to BetterPlacemaking.SERVER.EXPRESS (no visualizer.routes.ts/rplidar.routes.ts, no
 * visualizerApi/rplidarApi client), and scan.routes.ts's own `.../xyz` download and
 * `.../visualizer/latest` endpoints always resolve to "not implemented" (see scanService.ts's
 * downloadScanXyz/ingestLatestCompleteScanForVisualizer). So unlike Fusion's 404-detected gap,
 * this is a known, permanent gap with no endpoint to even attempt - both viewers are mounted
 * with empty data (rendering their grid/axes only) behind an explanatory banner, rather than
 * faking points or silently doing nothing.
 */
export function ScanVisualPanel({ visualMode, onVisualModeChange }: ScanVisualPanelProps) {
  const pointCloudRef = useRef<PointCloudViewerHandle | null>(null);
  const solidRef = useRef<SolidObjectsViewHandle | null>(null);

  const [uploadSelected, setUploadSelected] = useState(false);

  return (
    <div className="mt-6 flex min-h-[min(70vh,640px)] flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => {onVisualModeChange("solids"), setUploadSelected(false)}} className={tabBtn(!uploadSelected && visualMode === "solids")}>
          2D View
        </button>
        <button type="button" onClick={() => {onVisualModeChange("3d"), setUploadSelected(false)}} className={tabBtn(!uploadSelected && visualMode === "3d")}>
          3D View
        </button>
        <button type="button" onClick={() => setUploadSelected(true)} className = {tabBtn(uploadSelected)}>
          Upload
        </button>
        {!uploadSelected ? (
          <button
            type="button"
            onClick={() => (visualMode === "3d" ? pointCloudRef.current?.resetView() : solidRef.current?.resetView())}
            className="ml-auto rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Reset View
          </button>
        ) : (<p></p>)}
      </div>


      {uploadSelected ? (
        <UploadDataPanel />
      ) : (
        <div>
          <p className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-700">
            Live point-cloud and detected-object visualization isn't available yet — the Rplidar raw data pipeline and the
            3D Visualizer/mesh subsystem haven't been ported to the backend. The viewport below is fully functional (orbit,
            pan, zoom, reset) but shows an empty scene until that data source exists.
          </p>

          <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-neutral-200">
            {visualMode === "3d" ? (
              <PointCloudViewer ref={pointCloudRef} className="h-full w-full" />
            ) : (
              <SolidObjectsView ref={solidRef} className="h-full w-full" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

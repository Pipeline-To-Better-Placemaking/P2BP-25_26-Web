import { useRef, type ChangeEvent } from "react";
import { HasPermission } from "../../../auth/HasPermission";
import { Permissions } from "../../../lib/permissions";
import type { FloorplanLibraryItemDto } from "../../../lib/floorplanTypes";

const btnSecondary =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50 disabled:opacity-50";

interface FloorplanLibraryPanelProps {
  projectId: string | undefined;
  floorplans: FloorplanLibraryItemDto[];
  floorplansLoading: boolean;
  uploadingFloorplan: boolean;
  selectedFloorplanId: string | null;
  onSelect: (id: string) => void;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  onOpenCalibration: () => void;
  calibrationDisabled: boolean;
}

/**
 * The "LiDAR Calibration" card - shared floorplan library (select/upload/delete) plus the
 * "Open LiDAR Calibration" button that pops the embedded MultiLidarCalibration modal. Ported
 * from scanner.html's floorplan-library section.
 */
export function FloorplanLibraryPanel({
  projectId,
  floorplans,
  floorplansLoading,
  uploadingFloorplan,
  selectedFloorplanId,
  onSelect,
  onUpload,
  onDelete,
  onOpenCalibration,
  calibrationDisabled,
}: FloorplanLibraryPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onUpload(file);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">Select a shared floorplan before opening the LiDAR calibration workspace.</p>

        <HasPermission permission={Permissions.Project.Update} projectId={projectId}>
          <button
            type="button"
            onClick={onOpenCalibration}
            disabled={calibrationDisabled}
            title={calibrationDisabled ? "Select a floorplan from the Floorplan Library first" : ""}
            className={btnSecondary}
          >
            Open LiDAR Calibration
          </button>
        </HasPermission>
      </div>

      <HasPermission permission={Permissions.Project.Update} projectId={projectId}>
        <div>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingFloorplan} className={btnSecondary}>
            {uploadingFloorplan ? "Uploading…" : "Upload Floorplan"}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileChange} />
        </div>
      </HasPermission>

      {floorplansLoading ? (
        <div className="py-3 text-center text-sm text-ink-muted">Loading floorplans...</div>
      ) : floorplans.length === 0 ? (
        <div className="py-4 text-center text-sm text-ink-muted">No floorplans uploaded yet.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
          {floorplans.map((fp) => {
            const selected = fp.Id === selectedFloorplanId;
            return (
              <div
                key={fp.Id}
                onClick={() => onSelect(fp.Id)}
                className={`flex cursor-pointer flex-col overflow-hidden rounded-lg border transition-all ${
                  selected ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500" : "border-slate-200 bg-slate-100"
                }`}
              >
                <div className="relative flex h-24 items-center justify-center overflow-hidden bg-slate-200">
                  {fp.ImageDownloadUrl ? (
                    <img src={fp.ImageDownloadUrl} className="h-full w-full object-cover" alt={fp.Nickname} />
                  ) : (
                    <span className="text-2xl opacity-30">🖼</span>
                  )}
                  {selected && (
                    <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-xs text-white">
                      ✓
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">{fp.Nickname}</div>
                    <div className="text-xs text-ink-muted">
                      {fp.ImageWidth} × {fp.ImageHeight}
                    </div>
                  </div>
                  <HasPermission permission={Permissions.Project.Update} projectId={projectId}>
                    <button
                      type="button"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(fp.Id);
                      }}
                      className="shrink-0 rounded-md p-1 text-red-600 hover:bg-red-50"
                    >
                      🗑
                    </button>
                  </HasPermission>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

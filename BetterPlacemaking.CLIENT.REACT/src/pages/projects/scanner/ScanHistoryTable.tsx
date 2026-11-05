import { HasPermission } from "../../../auth/HasPermission";
import { Permissions } from "../../../lib/permissions";
import type { ScanRecordDto } from "../../../lib/scanTypes";
import { STATUS_BADGE_CLASS, formatScanDateTime, getScanStatusLabel, getScanStatusSeverity } from "./scannerHelpers";

interface ScanHistoryTableProps {
  projectId: string | undefined;
  scanHistory: ScanRecordDto[];
  currentLidarDeviceName: string | null;
  deletingScanId: string | null;
  getDownloadUrl: (scanId: string) => string;
  onDelete: (scan: ScanRecordDto) => void;
}

/** The "Scan History" card - recent runs for the resolved LiDAR device. Ported from scanner.html's history table. */
export function ScanHistoryTable({
  projectId,
  scanHistory,
  currentLidarDeviceName,
  deletingScanId,
  getDownloadUrl,
  onDelete,
}: ScanHistoryTableProps) {
  if (scanHistory.length === 0) {
    return (
      <div className="py-8 text-center">
        <div className="text-2xl opacity-30">🗄</div>
        <div className="mt-2 text-sm font-medium text-ink">No scans yet</div>
        <div className="mt-1 text-sm text-ink-muted">Run a scan above to populate history.</div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-mauve text-left text-white">
          <tr>
            <th className="px-3 py-2 font-medium">Run</th>
            <th className="px-3 py-2 font-medium">Created</th>
            <th className="px-3 py-2 font-medium">Finished</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {scanHistory.map((scan) => (
            <tr key={scan.Id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-2">
                <div className="font-medium text-ink">Scan {scan.Id || "—"}</div>
                <div className="text-xs text-ink-muted">{currentLidarDeviceName || "LiDAR device"}</div>
                {scan.Error && (
                  <div className="max-w-xs truncate text-xs text-red-600" title={String(scan.Error)}>
                    {String(scan.Error)}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-ink-muted">{formatScanDateTime(scan.CreatedAt)}</td>
              <td className="px-3 py-2 text-ink-muted">{formatScanDateTime(scan.FinishedAt)}</td>
              <td className="px-3 py-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[getScanStatusSeverity(scan.Status)]}`}>
                  {getScanStatusLabel(scan.Status)}
                </span>
              </td>
              <td className="px-3 py-2 text-right">
                <div className="flex justify-end gap-2">
                  {scan.Id && (
                    <HasPermission permission={Permissions.Project.Export} projectId={projectId}>
                      <a
                        href={getDownloadUrl(scan.Id)}
                        download
                        className="rounded-md px-2 py-1 text-xs font-medium text-ink hover:bg-slate-100"
                        title="Download"
                      >
                        ⬇
                      </a>
                    </HasPermission>
                  )}

                  {scan.Id && (
                    <HasPermission permission={Permissions.Project.ScansDelete} projectId={projectId}>
                      <button
                        type="button"
                        onClick={() => onDelete(scan)}
                        disabled={deletingScanId === scan.Id}
                        title="Delete"
                        className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                      >
                        {deletingScanId === scan.Id ? "…" : "🗑"}
                      </button>
                    </HasPermission>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

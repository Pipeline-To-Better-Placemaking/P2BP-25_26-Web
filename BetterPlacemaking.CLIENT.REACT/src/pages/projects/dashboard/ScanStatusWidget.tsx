import { HasPermission } from "../../../auth/HasPermission";
import { Button } from "../../../components/prime";
import { Permissions } from "../../../lib/permissions";

interface ScanStatusWidgetProps {
  lastScanTime: Date;
  formatTimeAgo: (date: Date) => string;
  projectId: string | undefined;
  scanLoading: boolean;
  scanMessage: string | null;
  onRefresh: () => void;
  onOpenModelPage: () => void;
  onRunFullScan: () => void;
}

const AppScanStatusWidget = "app-scan-status-widget" as unknown as "div";

/** en-US Date.prototype.toLocaleString() (what the Angular template prints). */
function toLocale(d: Date): string {
  return d.toLocaleString();
}

/** Mirrors the Angular ScanStatusWidget. */
export function ScanStatusWidget({
  lastScanTime,
  formatTimeAgo,
  projectId,
  scanLoading,
  scanMessage,
  onRefresh,
  onOpenModelPage,
  onRunFullScan,
}: ScanStatusWidgetProps) {
  return (
    <AppScanStatusWidget>
      <div className="bp-card p-6">
        <div className="flex items-center justify-between mb-6">
          <button type="button" className="text-xl font-semibold text-left hover:underline" onClick={onOpenModelPage}>
            Last Scan
          </button>

          <Button icon="pi pi-refresh" text rounded onClick={onRefresh} />
        </div>

        <div className="flex-grow flex flex-col items-center justify-center cursor-pointer" onClick={onOpenModelPage}>
          <div className="text-center mb-6">
            <i className="pi pi-clock text-6xl text-blue-500 mb-4"></i>
            <div className="text-4xl font-bold mb-2">{formatTimeAgo(lastScanTime)}</div>
            <div className="text-ink-muted">Last completed scan</div>
          </div>

          <div className="text-sm">{toLocale(lastScanTime)}</div>
        </div>

        <div className="mt-6">
          <HasPermission permission={Permissions.Project.ScansStart} projectId={projectId}>
            <Button
              label="Run Full Scan"
              icon="pi pi-search"
              className="w-full"
              loading={scanLoading}
              disabled={scanLoading}
              onClick={onRunFullScan}
            />
          </HasPermission>
          {scanMessage && (
            <div className={"mt-2 text-center text-sm " + (scanMessage.includes("Failed") ? "text-red-500" : "text-green-600")}>
              {scanMessage}
            </div>
          )}
        </div>
      </div>
    </AppScanStatusWidget>
  );
}

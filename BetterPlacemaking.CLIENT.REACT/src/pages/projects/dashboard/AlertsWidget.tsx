import { Badge, Button } from "../../../components/prime";
import type { AlertCounts, DashboardAlert } from "../../../lib/dashboardTypes";

interface AlertsWidgetProps {
  alerts: DashboardAlert[];
  alertCounts: AlertCounts;
  formatTimeAgo: (date: Date) => string;
  onRefresh: () => void;
  onOpenDevicesPage: () => void;
}

const AppAlertsWidget = "app-alerts-widget" as unknown as "div";

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    low: "bg-blue-100 text-blue-800",
    medium: "bg-yellow-100 text-yellow-800",
    high: "bg-orange-100 text-orange-800",
    critical: "bg-red-100 text-red-800",
  };
  return colors[status] || "bg-gray-100 text-gray-800";
}

const SEVERITY_BORDER: Record<string, string> = {
  critical: "border-red-400",
  high: "border-orange-400",
  medium: "border-yellow-400",
  low: "border-blue-400",
};

const COUNT_BTN =
  "p-4 rounded-lg text-center bg-surface-100 border-surface-100 dark:bg-surface-800 border hover:opacity-80 transition";

/** Mirrors the Angular AlertsWidget (the whole card is clickable; inner clicks bubble like in Angular). */
export function AlertsWidget({ alerts, alertCounts, formatTimeAgo, onRefresh, onOpenDevicesPage }: AlertsWidgetProps) {
  return (
    <AppAlertsWidget>
      <div
        className="card bg-surface-0 dark:bg-surface-900 shadow-sm rounded-xl border border-surface-300 dark:border-surface-700 p-6 bg-black min-h-[50dvh]"
        onClick={onOpenDevicesPage}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button type="button" className="text-[#334155] text-xl  font-semibold text-left hover:underline" onClick={onOpenDevicesPage}>
              Alerts
            </button>

            <Button icon="pi pi-refresh text-[#4f39f6]"  text rounded onClick={onRefresh} />
          </div>

          <button
            type="button"
            className="flex items-center space-x-2 hover:opacity-80 transition"
            onClick={onOpenDevicesPage}
          >
            {alertCounts.unresolved > 0 && <Badge value={alertCounts.unresolved} severity="danger" />}
            <span className="text-sm  text-gray-600">{alertCounts.unresolved} unresolved</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <button type="button" className={COUNT_BTN} onClick={onOpenDevicesPage}>
            <div className="text-3xl  font-bold text-[#334155]">{alertCounts.high}</div>
            <div className="text-sm mt-1 text-[#334155] font-bold">High</div>
          </button>

          <button type="button" className={COUNT_BTN} onClick={onOpenDevicesPage}>
            <div className="text-3xl  font-bold text-[#334155]" >{alertCounts.critical}</div>
            <div className="text-sm mt-1 text-[#334155] font-bold">Critical</div>
          </button>
        </div>

        <h4 className="text-lg  font-Inter font-semibold text-[#334155] mb-3">Recent Alerts</h4>

        {alerts.length === 0 && <div className="text-sm  text-gray-500">No active alerts.</div>}

        {alerts.length > 0 && (
          <div className="space-y-3 max-h-80 overflow-y-auto pr-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={"p-3 rounded border-l-4 border dark:border-surface-700 " + (SEVERITY_BORDER[alert.severity] ?? "")}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className={"px-2 py-1 rounded text-xs  font-medium " + getStatusColor(alert.severity)}>
                      {alert.severity.toUpperCase()}
                    </span>
                    <div className="mt-2 text-sm ">{alert.message}</div>
                  </div>

                  <div className="flex items-center">
                    <span className="text-xs  mr-2">{formatTimeAgo(alert.timestamp)}</span>
                    {alert.resolved ? (
                      <i className="pi pi-check-circle text-green-500"></i>
                    ) : (
                      <i className="pi pi-exclamation-circle text-red-500"></i>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppAlertsWidget>
  );
}
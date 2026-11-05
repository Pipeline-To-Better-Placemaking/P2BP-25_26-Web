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
  return colors[status] || "bg-slate-100 text-ink";
}

const SEVERITY_BORDER: Record<string, string> = {
  critical: "border-red-400",
  high: "border-orange-400",
  medium: "border-yellow-400",
  low: "border-blue-400",
};

const COUNT_BTN =
  "p-4 rounded-lg text-center bg-slate-100 text-ink hover:bg-slate-200 transition";

/** Mirrors the Angular AlertsWidget (the whole card is clickable; inner clicks bubble like in Angular). */
export function AlertsWidget({ alerts, alertCounts, formatTimeAgo, onRefresh, onOpenDevicesPage }: AlertsWidgetProps) {
  return (
    <AppAlertsWidget>
      <div
        className="bp-card p-6 min-h-[50dvh]"
        onClick={onOpenDevicesPage}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button type="button" className="text-xl font-semibold text-ink text-left hover:underline" onClick={onOpenDevicesPage}>
              Alerts
            </button>

            <Button icon="pi pi-refresh text-brand-600"  text rounded onClick={onRefresh} />
          </div>

          <button
            type="button"
            className="flex items-center space-x-2 hover:opacity-80 transition"
            onClick={onOpenDevicesPage}
          >
            {alertCounts.unresolved > 0 && <Badge value={alertCounts.unresolved} severity="danger" />}
            <span className="text-sm  text-ink-muted">{alertCounts.unresolved} unresolved</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <button type="button" className={COUNT_BTN} onClick={onOpenDevicesPage}>
            <div className="text-3xl font-bold text-ink">{alertCounts.high}</div>
            <div className="text-sm mt-1 font-semibold text-ink">High</div>
          </button>

          <button type="button" className={COUNT_BTN} onClick={onOpenDevicesPage}>
            <div className="text-3xl font-bold text-ink">{alertCounts.critical}</div>
            <div className="text-sm mt-1 font-semibold text-ink">Critical</div>
          </button>
        </div>

        <h4 className="text-lg  font-semibold text-ink mb-3">Recent Alerts</h4>

        {alerts.length === 0 && <div className="text-sm  text-ink-muted">No active alerts.</div>}

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
                    <span className="text-xs text-ink-muted mr-2">{formatTimeAgo(alert.timestamp)}</span>
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
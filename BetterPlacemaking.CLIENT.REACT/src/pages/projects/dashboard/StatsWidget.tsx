import type { MouseEvent } from "react";
import { Button } from "../../../components/prime";
import type { AlertCounts, DeviceCounts, ProjectViewModel } from "../../../lib/dashboardTypes";

interface StatsWidgetProps {
  project: ProjectViewModel;
  deviceCounts: DeviceCounts;
  alertCounts: AlertCounts;
  onRefresh: () => void;
  onProjectProgressClick: () => void;
  onDevicesClick: () => void;
  onAlertsClick: () => void;
}

const AppStatsWidget = "app-stats-widget" as unknown as "div";

const CARD =
  "col-span-12 lg:col-span-6 xl:col-span-4 bp-card p-6 cursor-pointer hover:opacity-95 transition";

function titlecase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Mirrors the Angular StatsWidget (host has class="contents"; three cards are grid children). */
export function StatsWidget({
  project,
  deviceCounts,
  alertCounts,
  onRefresh,
  onProjectProgressClick,
  onDevicesClick,
  onAlertsClick,
}: StatsWidgetProps) {
  function onRefreshClick(e: MouseEvent) {
    e.stopPropagation();
    onRefresh();
  }

  return (
    <AppStatsWidget className="contents">
      <div className={CARD} onClick={onProjectProgressClick}>
        <div className="card shadow-sm mb-0">
          <div className="flex justify-between mb-4">
            <div>
              <span className="block text-muted-color font-medium mb-4">Project Progress</span>
              <div className="text-ink dark:text-surface-0 font-medium text-xl">{project.progress}%</div>
            </div>
            <div className="flex items-center gap-2">
              <Button icon="pi pi-refresh" text rounded onClick={onRefreshClick} />
            </div>
          </div>
          <span className="text-primary font-medium">{titlecase(project.status)}</span>
          <span className="text-muted-color"> project status</span>
        </div>
      </div>

      <div className={CARD} onClick={onDevicesClick}>
        <div className="card shadow-sm mb-0">
          <div className="flex justify-between mb-4">
            <div>
              <span className="block text-muted-color font-medium mb-4">Devices</span>
              <div className="text-ink dark:text-surface-0 font-medium text-xl">{deviceCounts.total}</div>
            </div>
          </div>
          <span className="text-primary font-medium">{deviceCounts.online}</span>
          <span className="text-muted-color"> online now</span>
        </div>
      </div>

      <div className={CARD} onClick={onAlertsClick}>
        <div className="card shadow-sm mb-0">
          <div className="flex justify-between mb-4">
            <div>
              <span className="block text-muted-color font-medium mb-4">Alerts</span>
              <div className="text-ink dark:text-surface-0 font-medium text-xl">{alertCounts.unresolved}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button icon="pi pi-refresh" text rounded onClick={onRefreshClick} />
            </div>
          </div>
          <span className="text-primary font-medium">{alertCounts.critical}</span>
          <span className="text-muted-color"> critical alerts</span>
        </div>
      </div>
    </AppStatsWidget>
  );
}

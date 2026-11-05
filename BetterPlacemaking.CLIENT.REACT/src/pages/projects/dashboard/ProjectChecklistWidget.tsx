import { Button } from "../../../components/prime";
import type { DeviceCounts, ProjectViewModel } from "../../../lib/dashboardTypes";

interface ProjectChecklistWidgetProps {
  project: ProjectViewModel;
  deviceCounts: DeviceCounts;
  onRefresh: () => void;
  onDevicesAddedClick: () => void;
  onOfflineDevicesFixedClick: () => void;
  onWarningsResolvedClick: () => void;
}

const AppProjectChecklistWidget = "app-project-checklist-widget" as unknown as "div";

const ROW =
  "w-full flex justify-between items-center border-b border-surface-200 dark:border-surface-700 pb-2 text-left hover:bg-surface-50 dark:hover:bg-surface-800 rounded px-2 py-2 transition";

/** Mirrors the Angular ProjectChecklistWidget. */
export function ProjectChecklistWidget({
  project,
  deviceCounts,
  onRefresh,
  onDevicesAddedClick,
  onOfflineDevicesFixedClick,
  onWarningsResolvedClick,
}: ProjectChecklistWidgetProps) {
  return (
    <AppProjectChecklistWidget>
      <div className="bp-card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-ink">Project Checklist</h3>
          <Button icon="pi pi-refresh" text rounded onClick={onRefresh} />
        </div>

        <div className="mb-4">
          <div className="text-lg font-semibold">{project.title}</div>
          <div className="text-sm text-muted-color mt-1">{project.description}</div>
        </div>

        <div className="mb-4 p-3 rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="text-sm font-medium mb-2">Current Status</div>
          {project.checklistMessage && <div className="text-sm text-orange-600">{project.checklistMessage}</div>}
        </div>

        <div className="space-y-3">
          <button type="button" className={ROW} onClick={onDevicesAddedClick}>
            <span>Devices added</span>
            <span className="font-medium">{deviceCounts.total > 0 ? "Yes" : "No"}</span>
          </button>

          <button type="button" className={ROW} onClick={onOfflineDevicesFixedClick}>
            <span>Offline devices fixed</span>
            <span className="font-medium">{deviceCounts.offline === 0 ? "Yes" : "No"}</span>
          </button>

          <button type="button" className={ROW} onClick={onWarningsResolvedClick}>
            <span>Warnings resolved</span>
            <span className="font-medium">{deviceCounts.warning === 0 ? "Yes" : "No"}</span>
          </button>

          <div className="flex justify-between items-center px-2 py-2">
            <span>Project ready</span>
            <span className="font-medium">{project.progress === 100 ? "Yes" : "No"}</span>
          </div>
        </div>
      </div>
    </AppProjectChecklistWidget>
  );
}

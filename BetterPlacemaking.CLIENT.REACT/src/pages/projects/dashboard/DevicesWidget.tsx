import { useState } from "react";
import type { DeviceDto } from "../../../lib/deviceTypes";
import type { DeviceStatus } from "../../../lib/dashboardTypes";
import { Button } from "../../../components/prime";
import { DeviceHealthReport } from "../../devices/DeviceHealthReport";

interface DevicesWidgetProps {
  devices: DeviceDto[];
  loading: boolean;
  error: string | null;
  getDeviceStatus: (device: DeviceDto) => DeviceStatus;
  getDeviceLastSeen: (device: DeviceDto) => string;
  onRefresh: () => void;
  onOpenDevicesPage: () => void;
}

const AppDevicesWidget = "app-devices-widget" as unknown as "div";

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    online: "bg-green-500",
    offline: "bg-red-500",
    warning: "bg-yellow-500",
  };
  return colors[status] || "bg-slate-400";
}

/** Mirrors the Angular DevicesWidget. */
export function DevicesWidget({
  devices,
  loading,
  error,
  getDeviceStatus,
  getDeviceLastSeen,
  onRefresh,
  onOpenDevicesPage,
}: DevicesWidgetProps) {
  const [detailsDevice, setDetailsDevice] = useState<DeviceDto | null>(null);

  return (
    <AppDevicesWidget>
      <div className="bp-card p-6 min-h-[50dvh]">
        <div className="flex items-center justify-between mb-7">
          <div>
            <button type="button" className="text-xl font-semibold text-ink text-left hover:underline" onClick={onOpenDevicesPage}>
              Device List
            </button>

            <div className="text-xs text-ink-muted mt-1">
            </div>
          </div>

          <Button icon="pi pi-refresh text-brand-600" text rounded onClick={onRefresh} />
        </div>

        {loading && <div className="text-sm  text-ink-muted">Loading devices...</div>}

        {error && <div className="text-sm  text-red-500">{error}</div>}

        {!loading && !error && devices.length === 0 && (
          <div className="text-sm text-ink-muted">No devices are assigned yet.</div>
        )}

        {devices.length > 0 && (
          <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
            {devices.map((device) => (
              <div
                key={device.Id}
                className="flex items-center justify-between p-2 border-b border-surface-200 dark:border-surface-700 "
              >
                <div className="flex items-center">
                  <span className={"w-3 h-3 rounded-full mr-3 " + getStatusColor(getDeviceStatus(device))}></span>

                  <div>
                    <div className="  font-medium text-ink">{device.Name}</div>
                    <div className="text-sm text-ink-muted">Device Status: {getDeviceStatus(device)}</div>
                    <div className="text-sm text-ink-muted">
                      Last seen: {getDeviceLastSeen(device)}
                    </div>
                  </div>
                </div>    
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-60"
                  >
                    Start Scan
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailsDevice(device)}
                    className="rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-200 disabled:opacity-60"
                  >
                    Device Details
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {detailsDevice && <DeviceHealthReport device={detailsDevice} onClose={() => setDetailsDevice(null)} />}
    </AppDevicesWidget>
  );
}

import { Modal } from "../../components/Modal";
import type { DeviceDto } from "../../lib/deviceTypes";

interface DeviceHealthReportProps {
  device: DeviceDto;
  onClose: () => void;
}

function severityClass(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s === "ok" || s === "done") return "bg-emerald-100 text-emerald-800";
  if (s === "warning" || s === "collecting") return "bg-amber-100 text-amber-800";
  if (s === "critical") return "bg-red-100 text-red-800";
  return "bg-slate-100 text-ink";
}

function Tag({ label }: { label: string | null | undefined }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${severityClass(label)}`}>{label ?? "—"}</span>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

export function DeviceHealthReport({ device, onClose }: DeviceHealthReportProps) {
  const report = device.HealthReport;

  return (
    <Modal title={`Health Report — ${device.Name}`} onClose={onClose} widthClassName="max-w-3xl">
      {!report ? (
        <p className="text-sm text-ink-muted">No health report available for this device yet.</p>
      ) : (
        <div className="space-y-4 text-sm">
          <Panel title="Device">
            <dl className="grid grid-cols-2 gap-1 text-ink">
              <dt className="text-ink-muted">Name</dt>
              <dd>{device.Name}</dd>
              <dt className="text-ink-muted">Id</dt>
              <dd className="font-mono text-xs">{device.Id}</dd>
              <dt className="text-ink-muted">Timestamp</dt>
              <dd>{report.Timestamp}</dd>
            </dl>
          </Panel>

          {report.System && (
            <Panel title="System">
              <dl className="grid grid-cols-2 gap-1 text-ink">
                <dt className="text-ink-muted">GPU utilization</dt>
                <dd>{report.System.Gpu?.UtilizationPct ?? "—"}%</dd>
                <dt className="text-ink-muted">GPU frequency</dt>
                <dd>{report.System.Gpu?.FrequencyMhz ?? "—"} MHz</dd>
                <dt className="text-ink-muted">GPU temperature</dt>
                <dd>{report.System.Gpu?.TemperatureC ?? "—"}°C</dd>
                <dt className="text-ink-muted">CPU temperature</dt>
                <dd>{report.System.CpuTemperatureC ?? "—"}°C</dd>
                <dt className="text-ink-muted">Memory</dt>
                <dd>
                  {report.System.Memory?.UsedMb ?? "—"} / {report.System.Memory?.TotalMb ?? "—"} MB
                </dd>
              </dl>
            </Panel>
          )}

          {report.System?.Disk && report.System.Disk.length > 0 && (
            <Panel title="Disk">
              <table className="w-full text-left text-xs">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="py-1 pr-2">Path</th>
                    <th className="py-1 pr-2">Used/Total</th>
                    <th className="py-1 pr-2">Use %</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1">Deleted Files</th>
                  </tr>
                </thead>
                <tbody>
                  {report.System.Disk.map((disk, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-1 pr-2">{disk.Path}</td>
                      <td className="py-1 pr-2">
                        {disk.UsedMb ?? "—"} / {disk.TotalMb ?? "—"} MB
                      </td>
                      <td className="py-1 pr-2">{disk.UsePct ?? "—"}%</td>
                      <td className="py-1 pr-2">
                        <Tag label={disk.Status} />
                      </td>
                      <td className="py-1">{disk.DeletedFiles ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          {report.Services && Object.keys(report.Services).length > 0 && (
            <Panel title="Services">
              <table className="w-full text-left text-xs">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="py-1 pr-2">Name</th>
                    <th className="py-1 pr-2">Active</th>
                    <th className="py-1">Sub</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(report.Services).map(([name, status]) => (
                    <tr key={name} className="border-t border-slate-100">
                      <td className="py-1 pr-2">{name}</td>
                      <td className="py-1 pr-2">{status.Active ? "Yes" : "No"}</td>
                      <td className="py-1">{status.Sub ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          {report.Cameras && Object.keys(report.Cameras).length > 0 && (
            <Panel title="Cameras">
              <table className="w-full text-left text-xs">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="py-1 pr-2">Key</th>
                    <th className="py-1 pr-2">MAC</th>
                    <th className="py-1 pr-2">IP</th>
                    <th className="py-1 pr-2">Resolution</th>
                    <th className="py-1">Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(report.Cameras).map(([key, cam]) => (
                    <tr key={key} className="border-t border-slate-100">
                      <td className="py-1 pr-2">{key}</td>
                      <td className="py-1 pr-2">{cam.Mac ?? "—"}</td>
                      <td className="py-1 pr-2">{cam.Ip ?? "—"}</td>
                      <td className="py-1 pr-2">{cam.Resolution ? cam.Resolution.join("x") : "—"}</td>
                      <td className="py-1">{cam.Enabled ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          {report.IntrinsicsCalibration && Object.keys(report.IntrinsicsCalibration).length > 0 && (
            <Panel title="Intrinsics Calibration">
              <table className="w-full text-left text-xs">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="py-1 pr-2">MAC</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pr-2">Sightings</th>
                    <th className="py-1 pr-2">Coverage</th>
                    <th className="py-1">RMSE</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(report.IntrinsicsCalibration).map(([mac, state]) => {
                    const grid = state.CoverageGrid ?? [];
                    const filled = grid.filter((v) => v > 0).length;
                    return (
                      <tr key={mac} className="border-t border-slate-100">
                        <td className="py-1 pr-2">{mac}</td>
                        <td className="py-1 pr-2">
                          <Tag label={state.Status} />
                        </td>
                        <td className="py-1 pr-2">{state.SightingsCollected ?? 0}</td>
                        <td className="py-1 pr-2">
                          {filled}/{grid.length}
                        </td>
                        <td className="py-1">{state.CurrentRmse != null ? state.CurrentRmse.toFixed(3) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      )}
    </Modal>
  );
}

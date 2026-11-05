import { useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "../../components/Modal";
import type {
  ArucoLockConfig,
  CameraConfig,
  CharucoBoardConfig,
  Config,
  DeviceDto,
  IntrinsicsConfig,
  TrackingConfig,
} from "../../lib/deviceTypes";
import type { DeviceInput } from "../../services/deviceApi";
import type { ProjectDto } from "../../lib/projectTypes";

interface DeviceFormProps {
  device?: DeviceDto;
  projects: ProjectDto[];
  defaultProjectId?: string;
  onSave: (input: DeviceInput) => void;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-ink">{title}</legend>
      <div className="mt-2 grid grid-cols-2 gap-3">{children}</div>
    </fieldset>
  );
}

function Field({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={`block text-xs font-medium text-ink-muted ${full ? "col-span-2" : ""}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-ink focus:border-brand-500 focus:outline-none";

export function DeviceForm({ device, projects, defaultProjectId, onSave, onClose }: DeviceFormProps) {
  const config = device?.Config;

  const [projectId, setProjectId] = useState(device?.ProjectId ?? defaultProjectId ?? "");
  const [name, setName] = useState(device?.Name ?? "");
  const [heartbeatInterval, setHeartbeatInterval] = useState(config?.HeartbeatInterval ?? 10);
  const [version, setVersion] = useState(config?.Version ?? "");

  const [includeTracking, setIncludeTracking] = useState(!!config?.Tracking);
  const [tracking, setTracking] = useState<TrackingConfig>(
    config?.Tracking ?? { Enabled: false, Model: "", ConfidenceThreshold: 0.5, MaxFps: 30 },
  );

  const [includeCamera, setIncludeCamera] = useState(!!config?.Camera);
  const [camera, setCamera] = useState<CameraConfig>(config?.Camera ?? { Resolution: "", Framerate: 30, Codec: "" });

  const [trackingCameras, setTrackingCameras] = useState<{ mac: string; enabled: boolean; existing: boolean }[]>(
    Object.entries(config?.TrackingCameras ?? {}).map(([mac, enabled]) => ({ mac, enabled, existing: true })),
  );

  const [includeCharuco, setIncludeCharuco] = useState(!!config?.CharucoBoard);
  const [charuco, setCharuco] = useState<CharucoBoardConfig>(
    config?.CharucoBoard ?? {
      BeginScanning: false,
      ReferencePoints: { P1: { X: 0, Y: 0 }, P2: { X: 0, Y: 0 } },
      Board: { SquaresX: 5, SquaresY: 7, SquareSize: 0.04, ArucoSize: 0.03, Dictionary: "DICT_4X4_50" },
    },
  );

  const [includeArucoLock, setIncludeArucoLock] = useState(!!config?.ArucoLock);
  const [arucoLock, setArucoLock] = useState<ArucoLockConfig>(
    config?.ArucoLock ?? { BeginScanning: false, ArucoDict: "DICT_4X4_50", MinFrames: 10, MaxSecondsPerCam: 10 },
  );

  const [includeIntrinsics, setIncludeIntrinsics] = useState(!!config?.Intrinsics);
  const [intrinsics, setIntrinsics] = useState<IntrinsicsConfig>(
    config?.Intrinsics ?? { BeginCalibration: false, ModelId: "", MinSightings: 40, GridCells: 9 },
  );

  function addTrackingCameraRow() {
    setTrackingCameras((rows) => [...rows, { mac: "", enabled: true, existing: false }]);
  }

  function removeTrackingCameraRow(index: number) {
    setTrackingCameras((rows) => rows.filter((_, i) => i !== index));
  }

  function submit(e: FormEvent) {
    e.preventDefault();

    const trackingCamerasRecord =
      trackingCameras.length > 0
        ? Object.fromEntries(trackingCameras.filter((r) => r.mac.trim()).map((r) => [r.mac.trim(), r.enabled]))
        : undefined;

    const builtConfig: Config = {
      HeartbeatInterval: heartbeatInterval,
      Version: version || undefined,
      Tracking: includeTracking ? tracking : undefined,
      Camera: includeCamera ? camera : undefined,
      TrackingCameras: trackingCamerasRecord,
      CharucoBoard: includeCharuco ? charuco : undefined,
      ArucoLock: includeArucoLock ? arucoLock : undefined,
      Intrinsics: includeIntrinsics ? intrinsics : undefined,
    };

    onSave({ ProjectId: projectId, Name: name, Config: builtConfig });
  }

  return (
    <Modal title={device ? "Edit Device" : "Add Device"} onClose={onClose} widthClassName="max-w-2xl">
      <form className="space-y-4" onSubmit={submit}>
        <Section title="Device Details">
          <Field label="Project">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={inputClass}
            >
              <option value="">— Select a project —</option>
              {projects.map((p) => (
                <option key={p.Id} value={p.Id}>
                  {p.Title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name">
            <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
        </Section>

        <Section title="Jetson Configuration">
          <Field label="Heartbeat Interval (s)">
            <input
              type="number"
              min={1}
              required
              value={heartbeatInterval}
              onChange={(e) => setHeartbeatInterval(Number(e.target.value))}
              className={inputClass}
            />
          </Field>
          <Field label="Version">
            <input value={version} onChange={(e) => setVersion(e.target.value)} className={inputClass} />
          </Field>
        </Section>

        <Section title="Tracking">
          <Field label="Include this section" full>
            <input type="checkbox" checked={includeTracking} onChange={(e) => setIncludeTracking(e.target.checked)} />
          </Field>
          {includeTracking && (
            <>
              <Field label="Enabled">
                <input
                  type="checkbox"
                  checked={tracking.Enabled}
                  onChange={(e) => setTracking({ ...tracking, Enabled: e.target.checked })}
                />
              </Field>
              <Field label="Model">
                <input
                  value={tracking.Model ?? ""}
                  onChange={(e) => setTracking({ ...tracking, Model: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Confidence Threshold">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={tracking.ConfidenceThreshold}
                  onChange={(e) => setTracking({ ...tracking, ConfidenceThreshold: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label="Max FPS">
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={tracking.MaxFps}
                  onChange={(e) => setTracking({ ...tracking, MaxFps: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
            </>
          )}
        </Section>

        <Section title="Camera">
          <Field label="Include this section" full>
            <input type="checkbox" checked={includeCamera} onChange={(e) => setIncludeCamera(e.target.checked)} />
          </Field>
          {includeCamera && (
            <>
              <Field label="Resolution">
                <input
                  value={camera.Resolution ?? ""}
                  onChange={(e) => setCamera({ ...camera, Resolution: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Framerate">
                <input
                  type="number"
                  min={0}
                  max={240}
                  value={camera.Framerate}
                  onChange={(e) => setCamera({ ...camera, Framerate: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label="Codec">
                <input
                  value={camera.Codec ?? ""}
                  onChange={(e) => setCamera({ ...camera, Codec: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </>
          )}
        </Section>

        <fieldset className="rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-ink">Tracking Cameras</legend>
          <div className="mt-2 space-y-2">
            {trackingCameras.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  placeholder="MAC address"
                  disabled={row.existing}
                  value={row.mac}
                  onChange={(e) =>
                    setTrackingCameras((rows) => rows.map((r, idx) => (idx === i ? { ...r, mac: e.target.value } : r)))
                  }
                  className={`${inputClass} ${row.existing ? "bg-slate-100 text-ink-muted" : ""}`}
                />
                <label className="flex items-center gap-1 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) =>
                      setTrackingCameras((rows) =>
                        rows.map((r, idx) => (idx === i ? { ...r, enabled: e.target.checked } : r)),
                      )
                    }
                  />
                  Enabled
                </label>
                <button
                  type="button"
                  onClick={() => removeTrackingCameraRow(i)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            ))}
            <button type="button" onClick={addTrackingCameraRow} className="text-xs text-brand-600 hover:underline">
              + Add camera
            </button>
          </div>
        </fieldset>

        <Section title="Charuco Board">
          <Field label="Include this section" full>
            <input type="checkbox" checked={includeCharuco} onChange={(e) => setIncludeCharuco(e.target.checked)} />
          </Field>
          {includeCharuco && (
            <>
              <Field label="Begin Scanning">
                <input
                  type="checkbox"
                  checked={charuco.BeginScanning}
                  onChange={(e) => setCharuco({ ...charuco, BeginScanning: e.target.checked })}
                />
              </Field>
              <Field label="Dictionary">
                <input
                  value={charuco.Board?.Dictionary ?? ""}
                  onChange={(e) => setCharuco({ ...charuco, Board: { ...charuco.Board!, Dictionary: e.target.value } })}
                  className={inputClass}
                />
              </Field>
              <Field label="Squares X">
                <input
                  type="number"
                  value={charuco.Board?.SquaresX ?? 0}
                  onChange={(e) =>
                    setCharuco({ ...charuco, Board: { ...charuco.Board!, SquaresX: Number(e.target.value) } })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="Squares Y">
                <input
                  type="number"
                  value={charuco.Board?.SquaresY ?? 0}
                  onChange={(e) =>
                    setCharuco({ ...charuco, Board: { ...charuco.Board!, SquaresY: Number(e.target.value) } })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="Square Size (m)">
                <input
                  type="number"
                  step={0.001}
                  value={charuco.Board?.SquareSize ?? 0}
                  onChange={(e) =>
                    setCharuco({ ...charuco, Board: { ...charuco.Board!, SquareSize: Number(e.target.value) } })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="Aruco Size (m)">
                <input
                  type="number"
                  step={0.001}
                  value={charuco.Board?.ArucoSize ?? 0}
                  onChange={(e) =>
                    setCharuco({ ...charuco, Board: { ...charuco.Board!, ArucoSize: Number(e.target.value) } })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="Reference Point P1 (X, Y)">
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={charuco.ReferencePoints?.P1?.X ?? 0}
                    onChange={(e) =>
                      setCharuco({
                        ...charuco,
                        ReferencePoints: {
                          ...charuco.ReferencePoints,
                          P1: { X: Number(e.target.value), Y: charuco.ReferencePoints?.P1?.Y ?? 0 },
                        },
                      })
                    }
                    className={inputClass}
                  />
                  <input
                    type="number"
                    value={charuco.ReferencePoints?.P1?.Y ?? 0}
                    onChange={(e) =>
                      setCharuco({
                        ...charuco,
                        ReferencePoints: {
                          ...charuco.ReferencePoints,
                          P1: { X: charuco.ReferencePoints?.P1?.X ?? 0, Y: Number(e.target.value) },
                        },
                      })
                    }
                    className={inputClass}
                  />
                </div>
              </Field>
              <Field label="Reference Point P2 (X, Y)">
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={charuco.ReferencePoints?.P2?.X ?? 0}
                    onChange={(e) =>
                      setCharuco({
                        ...charuco,
                        ReferencePoints: {
                          ...charuco.ReferencePoints,
                          P2: { X: Number(e.target.value), Y: charuco.ReferencePoints?.P2?.Y ?? 0 },
                        },
                      })
                    }
                    className={inputClass}
                  />
                  <input
                    type="number"
                    value={charuco.ReferencePoints?.P2?.Y ?? 0}
                    onChange={(e) =>
                      setCharuco({
                        ...charuco,
                        ReferencePoints: {
                          ...charuco.ReferencePoints,
                          P2: { X: charuco.ReferencePoints?.P2?.X ?? 0, Y: Number(e.target.value) },
                        },
                      })
                    }
                    className={inputClass}
                  />
                </div>
              </Field>
            </>
          )}
        </Section>

        <Section title="ArUco Lock">
          <Field label="Include this section" full>
            <input
              type="checkbox"
              checked={includeArucoLock}
              onChange={(e) => setIncludeArucoLock(e.target.checked)}
            />
          </Field>
          {includeArucoLock && (
            <>
              <Field label="Begin Scanning">
                <input
                  type="checkbox"
                  checked={arucoLock.BeginScanning}
                  onChange={(e) => setArucoLock({ ...arucoLock, BeginScanning: e.target.checked })}
                />
              </Field>
              <Field label="Aruco Dictionary">
                <input
                  value={arucoLock.ArucoDict ?? "DICT_4X4_50"}
                  onChange={(e) => setArucoLock({ ...arucoLock, ArucoDict: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Min Frames">
                <input
                  type="number"
                  value={arucoLock.MinFrames ?? 10}
                  onChange={(e) => setArucoLock({ ...arucoLock, MinFrames: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label="Max Seconds Per Camera">
                <input
                  type="number"
                  value={arucoLock.MaxSecondsPerCam ?? 10}
                  onChange={(e) => setArucoLock({ ...arucoLock, MaxSecondsPerCam: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
            </>
          )}
        </Section>

        <Section title="Intrinsics Calibration">
          <Field label="Include this section" full>
            <input
              type="checkbox"
              checked={includeIntrinsics}
              onChange={(e) => setIncludeIntrinsics(e.target.checked)}
            />
          </Field>
          {includeIntrinsics && (
            <>
              <Field label="Begin Calibration">
                <input
                  type="checkbox"
                  checked={intrinsics.BeginCalibration}
                  onChange={(e) => setIntrinsics({ ...intrinsics, BeginCalibration: e.target.checked })}
                />
              </Field>
              <Field label="Model Id">
                <input
                  value={intrinsics.ModelId ?? ""}
                  onChange={(e) => setIntrinsics({ ...intrinsics, ModelId: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Min Sightings">
                <input
                  type="number"
                  value={intrinsics.MinSightings ?? 40}
                  onChange={(e) => setIntrinsics({ ...intrinsics, MinSightings: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label="Grid Cells">
                <input
                  type="number"
                  value={intrinsics.GridCells ?? 9}
                  onChange={(e) => setIntrinsics({ ...intrinsics, GridCells: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
            </>
          )}
        </Section>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-ink hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || !projectId}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

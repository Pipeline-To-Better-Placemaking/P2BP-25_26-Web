import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRotateRight, faPlay, faStop, faTriangleExclamation, faUpload } from "@fortawesome/free-solid-svg-icons";

/**
 * Calibration runs on the workstation; this page hosts a remote session to its GUI.
 * TODO(workstation-session): wire start/reset/stop, the live view and the floor plan upload
 * to the workstation once it exposes a remote-session endpoint. State is local-only for now.
 */

const SESSION_SECONDS = 25 * 60;

type SessionStatus = "idle" | "running" | "stopped";

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: "Not started",
  running: "Calibration in progress",
  stopped: "Calibration stopped",
};

function SessionConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-labelledby="session-confirm-title"
        className="flex w-full max-w-md gap-3 rounded-md border border-neutral-700 bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm text-red-600">
          <FontAwesomeIcon icon={faTriangleExclamation} />
        </div>
        <div className="grow">
          <h2 id="session-confirm-title" className="font-semibold text-neutral-800">
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-700">{message}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-sm border border-neutral-700 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Keep going
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-sm bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Calibration() {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [secondsLeft, setSecondsLeft] = useState(SESSION_SECONDS);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [sentFileName, setSentFileName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const running = status === "running";

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setStatus("stopped");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const start = () => {
    if (status !== "running") setSecondsLeft(SESSION_SECONDS);
    setStatus("running");
  };

  const reset = () => {
    setConfirmReset(false);
    setSecondsLeft(SESSION_SECONDS);
    setStatus("running");
  };

  const stop = () => {
    setConfirmStop(false);
    setStatus("stopped");
  };

  const onFileChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSentFileName(file.name);
    e.target.value = "";
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-800">Calibration</h1>
        <p className="mt-1 text-sm text-neutral-900">Calibration runs on the workstation. This page opens a remote session to its GUI.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-700 bg-white px-3 py-3">
        <button
          type="button"
          onClick={start}
          disabled={running}
          className="flex items-center gap-2 rounded-sm bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600 disabled:cursor-default disabled:hover:bg-slate-700"
        >
          <FontAwesomeIcon icon={faPlay} className="text-xs" />
          Start Calibration
        </button>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          disabled={status === "idle"}
          className="flex items-center gap-2 rounded-sm border border-neutral-700 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          <FontAwesomeIcon icon={faArrowRotateRight} className="text-xs" />
          Reset
        </button>
        <button
          type="button"
          onClick={() => setConfirmStop(true)}
          disabled={!running}
          className="flex items-center gap-2 rounded-sm border border-red-500 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          <FontAwesomeIcon icon={faStop} className="text-xs" />
          Stop
        </button>
        <span className="ml-auto pr-2 text-sm text-neutral-900">{STATUS_LABEL[status]}</span>
      </div>

      <div className="overflow-hidden rounded-md border border-neutral-700">
        <div className="flex items-center gap-3 bg-white px-4 py-2">
          <span className={`h-3 w-3 shrink-0 rounded-full ${running ? "bg-green-700" : "bg-neutral-400"}`} />
          <div className="grow">
            <div className="text-sm font-semibold text-neutral-800">Remote connection</div>
            <div className="text-xs text-neutral-700">
              {running ? "Connected to workstation · remote session active" : "Not connected · start calibration to open a session"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-neutral-700">Session time left</div>
            <div className="font-mono text-xl font-bold tracking-wider text-neutral-800">{formatTime(secondsLeft)}</div>
          </div>
        </div>
        <div className="relative flex h-[24rem] items-center justify-center bg-slate-700 text-sm text-neutral-100">
          <span className="absolute left-4 top-3">Calibration GUI · workstation</span>
          {running ? "Live view streams from the workstation" : "Start calibration to stream the workstation GUI"}
        </div>
      </div>

      <div className="w-full max-w-md rounded-md border border-neutral-700 bg-white p-3">
        <h3 className="font-semibold text-neutral-800">Send a floor plan to the workstation</h3>
        <p className="mt-0.5 text-xs text-neutral-900">Sends a file to the workstation. It is not stored in the project database.</p>
        <div className="mt-3 flex items-center gap-4 rounded-md border border-dashed border-neutral-700 px-3 py-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex items-center gap-2 rounded-sm bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600"
          >
            <FontAwesomeIcon icon={faUpload} />
            Upload File
          </button>
          <span className="truncate text-sm text-neutral-700">{sentFileName ? `Selected ${sentFileName}` : "No file sent yet"}</span>
          <input ref={fileInput} type="file" className="hidden" onChange={onFileChosen} />
        </div>
      </div>

      {confirmReset && (
        <SessionConfirmDialog
          title="Reset calibration?"
          message={`This restarts the session and the ${formatTime(SESSION_SECONDS)} timer. Progress in the workstation GUI will be lost.`}
          confirmLabel="Reset"
          onConfirm={reset}
          onCancel={() => setConfirmReset(false)}
        />
      )}
      {confirmStop && (
        <SessionConfirmDialog
          title="Stop calibration?"
          message="This ends the remote session with the workstation. Progress in the workstation GUI will be lost."
          confirmLabel="Stop"
          onConfirm={stop}
          onCancel={() => setConfirmStop(false)}
        />
      )}
    </div>
  );
}

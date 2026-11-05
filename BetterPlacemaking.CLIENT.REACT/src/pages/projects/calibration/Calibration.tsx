import { PageHeader } from "../../../components/PageHeader";
import { DANGER_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../../../components/buttonStyles";
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
        className="flex w-full max-w-md gap-3 rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm text-red-600">
          <FontAwesomeIcon icon={faTriangleExclamation} />
        </div>
        <div className="grow">
          <h2 id="session-confirm-title" className="text-lg font-semibold text-ink">
            {title}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{message}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50"
            >
              Keep going
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
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
    <div>
      <PageHeader
        title="Calibration"
        subtitle="Calibration runs on the workstation. This page opens a remote session to its GUI."
        actions={
          <>
            <button type="button" onClick={start} disabled={running} className={PRIMARY_BUTTON}>
              <FontAwesomeIcon icon={faPlay} className="text-xs" />
              Start Calibration
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              disabled={status === "idle"}
              className={SECONDARY_BUTTON}
            >
              <FontAwesomeIcon icon={faArrowRotateRight} className="text-xs" />
              Reset
            </button>
            <button type="button" onClick={() => setConfirmStop(true)} disabled={!running} className={DANGER_BUTTON}>
              <FontAwesomeIcon icon={faStop} className="text-xs" />
              Stop
            </button>
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <div className="bp-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 px-6 py-4">
            <span className={`h-3 w-3 shrink-0 rounded-full ${running ? "bg-green-500" : "bg-slate-400"}`} />
            <div className="grow">
              <h2 className="text-xl font-semibold text-ink">Remote Connection</h2>
              <p className="mt-1 text-sm text-ink-muted">
                {STATUS_LABEL[status]} ·{" "}
                {running ? "connected to workstation" : "start calibration to open a session"}
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-ink-muted">Session time left</div>
              <div className="font-mono text-2xl font-semibold tracking-wider text-ink">{formatTime(secondsLeft)}</div>
            </div>
          </div>
          <div className="relative flex h-[24rem] items-center justify-center bg-ink-muted text-sm font-medium text-white">
            <span className="absolute left-6 top-3 text-xs font-normal text-white/80">Calibration GUI · workstation</span>
            {running ? "Live view streams from the workstation" : "Start calibration to stream the workstation GUI"}
          </div>
        </div>

        <div className="bp-card w-full max-w-xl p-6">
          <h2 className="text-xl font-semibold text-ink">Send a Floor Plan to the Workstation</h2>
          <p className="mt-1 text-sm text-ink-muted">Sends a file to the workstation. It is not stored in the project database.</p>
          <div className="mt-4 flex items-center gap-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
            <button type="button" onClick={() => fileInput.current?.click()} className={PRIMARY_BUTTON}>
              <FontAwesomeIcon icon={faUpload} className="text-xs" />
              Upload File
            </button>
            <span className="truncate text-sm text-ink-muted">
              {sentFileName ? `Selected ${sentFileName}` : "No file sent yet"}
            </span>
            <input ref={fileInput} type="file" className="hidden" onChange={onFileChosen} />
          </div>
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

import { PageHeader } from "../../../components/PageHeader";
import { DANGER_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../../../components/buttonStyles";
import { Message, Tag, useConfirm } from "../../../components/prime";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateRight,
  faDownload,
  faForward,
  faPlay,
  faServer,
  faStop,
  faUpRightFromSquare,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { usePermission } from "../../../auth/usePermission";
import { Permissions } from "../../../lib/permissions";
import type { ProjectDto } from "../../../lib/projectTypes";
import type { FloorplanLibraryItemDto } from "../../../lib/floorplanTypes";
import * as projectApi from "../../../services/projectApi";
import * as floorplanLibraryApi from "../../../services/floorplanLibraryApi";
import {
  amcRequest,
  cancelAutomation,
  continueAutomation,
  describeWorkstationError,
  getAutomation,
  getWorkstationProject,
  isDownloadable,
  isMixedContent,
  isNotConfigured,
  listProjectFiles,
  projectFileUrl,
  provisionProject,
  requestTicket,
  startAutomation,
  WorkstationError,
  type AmcState,
  type AmcStatus,
  type AutomationJob,
  type AutomationJobState,
  type AutomationStepState,
  type WorkstationFile,
  type WorkstationProject,
  type WorkstationProjectState,
  type WorkstationTicket,
} from "./amcApi";

/**
 * Drives calibration on the DeepStream workstation for the current project: the project's
 * workstation folder, the shared AMC instance, automated calibration runs and the folder's
 * files. Contract: hardware repo `installer/plan/AMC-WEB-PROJECTS.md`, section 11.3.
 */

const PROVISION_POLL_MS = 3_000;
const PROVISION_POLL_CAP_MS = 30 * 60_000;
// Consecutive polling failures tolerated before reporting and giving up
const PROVISION_POLL_MAX_ERRORS = 5;
const AMC_POLL_MS = 2_000;
const AUTOMATION_POLL_MS = 3_000;
const TICKET_MARGIN_MS = 30_000;
// Length of a new footage recording, in whole minutes
const RECORD_MINUTES_MIN = 1;
const RECORD_MINUTES_MAX = 30;
const RECORD_MINUTES_DEFAULT = 5;

type Severity = "success" | "info" | "warn" | "danger" | "secondary";

const BINDING_SEVERITY: Record<WorkstationProjectState, Severity> = {
  provisioning: "info",
  ready: "success",
  failed: "danger",
};

const AMC_SEVERITY: Record<AmcState, Severity> = {
  down: "secondary",
  starting: "info",
  ready: "success",
  stopping: "info",
  error: "danger",
};

const JOB_LABEL: Record<AutomationJobState, string> = {
  running: "Running",
  waiting_for_user: "Waiting for you",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

const JOB_SEVERITY: Record<AutomationJobState, Severity> = {
  running: "info",
  waiting_for_user: "warn",
  completed: "success",
  failed: "danger",
  cancelled: "secondary",
  interrupted: "warn",
};

const STEP_SEVERITY: Record<AutomationStepState, Severity> = {
  pending: "secondary",
  running: "info",
  done: "success",
  skipped: "secondary",
  waiting: "warn",
  failed: "danger",
};

// States the workstation will accept a continue or a cancel for
const RESUMABLE: AutomationJobState[] = ["waiting_for_user", "failed", "interrupted"];
const CANCELLABLE: AutomationJobState[] = ["running", ...RESUMABLE];

function isActiveState(state: AutomationJobState | null | undefined): boolean {
  return state === "running" || state === "waiting_for_user";
}

function isActive(job: AutomationJob | null): boolean {
  return isActiveState(job?.State);
}

// Readable message for any failure; the workstation's own detail (such as why it is busy) is shown as is
const describe = describeWorkstationError;

function formatUnix(seconds: number | null | undefined): string {
  if (!seconds) return "Never";
  return new Date(seconds * 1000).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

// Current clips sit directly in footage/; the kept recording in footage/previous/ does not count
const FOOTAGE_CLIP = /^footage\/[^/]+\.mp4$/;

// True when the folder already holds recorded clips (footage/*.mp4)
function hasFootage(files: WorkstationFile[]): boolean {
  return files.some((f) => FOOTAGE_CLIP.test(f.Path));
}

// The minutes field as a whole number in range, or null when it isn't one
function parseRecordMinutes(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const minutes = Number(text.trim());
  return minutes >= RECORD_MINUTES_MIN && minutes <= RECORD_MINUTES_MAX ? minutes : null;
}

function isTicketFresh(ticket: WorkstationTicket): boolean {
  return Date.parse(ticket.ExpiresAt) - Date.now() > TICKET_MARGIN_MS;
}

/** Calls tick every intervalMs while active; stops when inactive or unmounted. */
function usePolling(active: boolean, intervalMs: number, tick: () => Promise<void>) {
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  });
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: number | undefined;
    const run = async () => {
      try {
        await tickRef.current();
      } finally {
        if (!stopped) timer = window.setTimeout(run, intervalMs);
      }
    };
    timer = window.setTimeout(run, intervalMs);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [active, intervalMs]);
}

// -- layout pieces --------------------------------------------------------------

function Panel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="bp-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-all text-sm text-ink">{children}</dd>
    </div>
  );
}

function ErrorText({ message }: { message: string | null }) {
  return message ? <Message severity="error" text={message} className="mt-4" /> : null;
}

// -- workstation project ----------------------------------------------------------

interface ProvisionWatch {
  // The provision ticket, used for polling while it is fresh
  ticket?: WorkstationTicket;
  deadline: number;
  errors: number;
}

/** The project's binding on the workstation, with setup and polling while it is provisioning. */
function useWorkstationBinding(projectId: string, hasFolder: boolean) {
  const [binding, setBinding] = useState<WorkstationProject | null>(null);
  const [loaded, setLoaded] = useState(!hasFolder);
  const [error, setError] = useState<string | null>(null);
  const [stalled, setStalled] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const watch = useRef<ProvisionWatch | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBinding(await getWorkstationProject(projectId, watch.current?.ticket));
      setError(null);
    } catch (err) {
      setError(describe(err));
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    if (hasFolder) void refresh();
  }, [hasFolder, refresh]);

  usePolling(binding?.State === "provisioning" && !stalled, PROVISION_POLL_MS, async () => {
    if (!watch.current) watch.current = { deadline: Date.now() + PROVISION_POLL_CAP_MS, errors: 0 };
    const w = watch.current;
    if (Date.now() > w.deadline) {
      setStalled("Still being set up after 30 minutes. Check again later.");
      return;
    }
    try {
      const next = await getWorkstationProject(projectId, w.ticket);
      w.errors = 0;
      if (next?.State !== "provisioning") watch.current = null;
      setBinding(next);
    } catch (err) {
      if (++w.errors >= PROVISION_POLL_MAX_ERRORS) setStalled(`Lost track of the setup. ${describe(err)}`);
    }
  });

  async function provision() {
    setSubmitting(true);
    setError(null);
    setStalled(null);
    try {
      const result = await provisionProject(projectId);
      watch.current = { ticket: result.Ticket, deadline: Date.now() + PROVISION_POLL_CAP_MS, errors: 0 };
      setBinding(result.Binding);
    } catch (err) {
      setError(describe(err));
    } finally {
      setSubmitting(false);
    }
  }

  function checkAgain() {
    watch.current = null;
    setStalled(null);
    void refresh();
  }

  return { binding, loaded, error, stalled, submitting, provision, refresh, checkAgain };
}

type BindingState = ReturnType<typeof useWorkstationBinding>;

function WorkstationProjectPanel({
  projectId,
  folder,
  state,
}: {
  projectId: string;
  folder: string | null;
  state: BindingState;
}) {
  const canProvision = usePermission(Permissions.Project.Update, { projectId });
  const { binding, loaded, error, stalled, submitting } = state;
  const canSetUp = !!folder && loaded && (!binding || binding.State === "failed");

  const actions = folder ? (
    <button type="button" onClick={() => void state.refresh()} disabled={!loaded} className={SECONDARY_BUTTON}>
      <FontAwesomeIcon icon={faArrowRotateRight} className="text-xs" />
      Refresh
    </button>
  ) : undefined;

  let body: ReactNode;
  if (!folder) {
    body = (
      <p className="text-sm text-ink-muted">
        This project has no workstation folder. A workstation folder is set when editing the project, and calibration
        runs on the workstation inside that folder.
      </p>
    );
  } else if (!loaded) {
    body = <p className="text-sm text-ink-muted">Checking the workstation...</p>;
  } else if (!binding) {
    body = (
      <p className="text-sm text-ink-muted">
        The workstation has no folder for <span className="font-mono text-ink">{folder}</span> yet.
      </p>
    );
  } else {
    body = (
      <>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Folder">
            <span className="font-mono">{binding.Folder}</span>
          </Field>
          <Field label="AMC project">{binding.AmcProjectName ?? "Not created yet"}</Field>
          <Field label="State">
            <Tag value={binding.State} severity={BINDING_SEVERITY[binding.State]} />
          </Field>
          <Field label="Last run">{formatUnix(binding.LastRunAt)}</Field>
          <Field label="Calibration runs">{binding.CalibRuns}</Field>
          <Field label="Path on the workstation">
            <span className="font-mono">{binding.Path}</span>
          </Field>
        </dl>
        {binding.State === "provisioning" && !stalled && (
          <p className="mt-4 text-sm text-ink-muted">
            Setting up the folder and AMC project. This can take a few minutes while AMC starts.
          </p>
        )}
        {binding.State === "failed" && (
          <Message severity="error" text={binding.Error || "Setup failed; the workstation did not say why."} className="mt-4" />
        )}
      </>
    );
  }

  return (
    <Panel title="Workstation Project" actions={actions}>
      <div aria-live="polite">{body}</div>
      {stalled && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Message severity="warn" text={stalled} />
          <button type="button" onClick={state.checkAgain} className={SECONDARY_BUTTON}>
            Check again
          </button>
        </div>
      )}
      {canSetUp && (
        <div className="mt-4">
          {canProvision ? (
            <button type="button" onClick={() => void state.provision()} disabled={submitting} className={PRIMARY_BUTTON}>
              <FontAwesomeIcon icon={faServer} className="text-xs" />
              {submitting ? "Setting up..." : "Set up on workstation"}
            </button>
          ) : (
            <p className="text-sm text-ink-muted">Ask someone who can edit this project to set it up on the workstation.</p>
          )}
        </div>
      )}
      <ErrorText message={error} />
    </Panel>
  );
}

// -- AMC ----------------------------------------------------------------------------

function AmcPanel({
  projectId,
  initialTicket,
  runState,
}: {
  projectId: string;
  initialTicket: WorkstationTicket;
  // The automated run's state: the runner starts and uses AMC itself
  runState: AutomationJobState | null;
}) {
  const confirmation = useConfirm();
  const ticket = useRef(initialTicket);
  const [status, setStatus] = useState<AmcStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Calls the AMC route with a fresh ticket, fetching a new one once if the workstation rejects it
  const call = useCallback(
    async (path: "/amc/status" | "/amc/start" | "/amc/stop", method: "GET" | "POST") => {
      const run = async (renew: boolean) => {
        if (renew || !isTicketFresh(ticket.current)) ticket.current = await requestTicket(projectId);
        return amcRequest(ticket.current.WorkstationUrl, ticket.current.Ticket, path, method);
      };
      try {
        return await run(false);
      } catch (err) {
        if (err instanceof WorkstationError && err.kind === "unauthorized") return run(true);
        throw err;
      }
    },
    [projectId],
  );

  const refresh = useCallback(async () => {
    try {
      setStatus(await call("/amc/status", "GET"));
      setError(null);
    } catch (err) {
      setError(describe(err));
    }
  }, [call]);

  useEffect(() => {
    call("/amc/status", "GET")
      .then(setStatus)
      .catch((err: unknown) => setError(describe(err)));
  }, [call, runState]);

  const transitioning = status?.State === "starting" || status?.State === "stopping";
  usePolling(transitioning || isActiveState(runState), AMC_POLL_MS, refresh);

  async function act(path: "/amc/start" | "/amc/stop") {
    setPending(true);
    setError(null);
    try {
      setStatus(await call(path, "POST"));
    } catch (err) {
      setError(describe(err));
    } finally {
      setPending(false);
    }
  }

  function confirmStop() {
    confirmation.confirm({
      header: "Stop AMC",
      message: "Stop AMC on the workstation? Anyone using its UI loses their session.",
      icon: "pi pi-exclamation-triangle",
      rejectButtonStyleClass: "p-button-text",
      acceptLabel: "Stop",
      rejectLabel: "Keep running",
      accept: () => void act("/amc/stop"),
    });
  }

  const state = status?.State;
  const canStart = !pending && (state === "down" || state === "error");
  const canStop = !pending && (state === "ready" || state === "starting" || state === "error");

  return (
    <Panel
      title="AMC"
      actions={
        <>
          <button type="button" onClick={() => void act("/amc/start")} disabled={!canStart} className={PRIMARY_BUTTON}>
            <FontAwesomeIcon icon={faPlay} className="text-xs" />
            Start
          </button>
          <button type="button" onClick={confirmStop} disabled={!canStop} className={DANGER_BUTTON}>
            <FontAwesomeIcon icon={faStop} className="text-xs" />
            Stop
          </button>
          {state === "ready" && status?.UiUrl && (
            <a href={status.UiUrl} target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
              <FontAwesomeIcon icon={faUpRightFromSquare} className="text-xs" />
              Open AMC
            </a>
          )}
          <button type="button" onClick={() => void refresh()} className={SECONDARY_BUTTON}>
            <FontAwesomeIcon icon={faArrowRotateRight} className="text-xs" />
            Refresh
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-muted">
        The calibration app on the workstation. It is shared by every project, so one person calibrates at a time.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-ink" aria-live="polite">
        <span>Status</span>
        {status ? <Tag value={status.State} severity={AMC_SEVERITY[status.State]} /> : <span className="text-ink-muted">Unknown</span>}
        {transitioning && <span className="text-ink-muted">Updating...</span>}
      </div>
      {status?.Error && <Message severity="error" text={status.Error} className="mt-4" />}
      <ErrorText message={error} />
    </Panel>
  );
}

// -- automated runs -------------------------------------------------------------------

function JobResult({ result }: { result: Record<string, unknown> }) {
  const entries = Object.entries(result);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-4 grid grid-cols-1 gap-3">
      {entries.map(([key, value]) => (
        <Field key={key} label={key}>
          {typeof value === "object" && value !== null ? (
            <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>
          ) : (
            String(value)
          )}
        </Field>
      ))}
    </dl>
  );
}

function JobDetails({ job }: { job: AutomationJob }) {
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Tag value={JOB_LABEL[job.State]} severity={JOB_SEVERITY[job.State]} />
        <span className="text-ink-muted">
          Started {formatUnix(job.StartedAt)}
          {job.AmcProjectName ? ` in AMC project ${job.AmcProjectName}` : ""}
        </span>
      </div>
      {job.Message && (
        <Message
          severity={job.State === "completed" ? "success" : job.State === "failed" ? "error" : "info"}
          text={job.Message}
          className="mt-4"
        />
      )}

      {job.State === "waiting_for_user" && job.UserActions.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-ink">To do in AMC, then press Continue</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
            {job.UserActions.map((action, i) => (
              <li key={i}>{action}</li>
            ))}
          </ul>
        </div>
      )}

      <ol className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200">
        {job.Steps.map((step) => (
          <li key={step.Key} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <span className="w-6 shrink-0 text-sm font-semibold text-ink-muted">{step.Number}</span>
            <div className="min-w-0 grow">
              <div className="text-sm font-medium text-ink">{step.Title}</div>
              {/* A running step's message is its live progress, such as how much of a recording is done */}
              {step.Message && (
                <div className={`mt-0.5 text-sm ${step.State === "running" ? "font-medium text-ink" : "text-ink-muted"}`}>
                  {step.Message}
                </div>
              )}
              {step.Done && <div className="mt-0.5 text-xs text-ink-muted">Done: {step.Done}</div>}
            </div>
            <Tag value={step.State} severity={STEP_SEVERITY[step.State]} />
          </li>
        ))}
      </ol>

      {job.State === "completed" && <JobResult result={job.Result} />}
    </div>
  );
}

function AutomationPanel({
  projectId,
  ready,
  folderHasFootage,
  onRunFinished,
  onStateChange,
}: {
  projectId: string;
  ready: boolean;
  // Whether the folder's file list holds footage/*.mp4; null until it has loaded
  folderHasFootage: boolean | null;
  onRunFinished: () => void;
  onStateChange: (state: AutomationJobState | null) => void;
}) {
  const confirmation = useConfirm();
  const [job, setJob] = useState<AutomationJob | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [floorplans, setFloorplans] = useState<FloorplanLibraryItemDto[]>([]);
  const [floorplanId, setFloorplanId] = useState("");
  // The user's own choice; until they make one, recording defaults to on when the folder has no footage
  const [recordChoice, setRecordChoice] = useState<boolean | null>(null);
  const [recordMinutesText, setRecordMinutesText] = useState(String(RECORD_MINUTES_DEFAULT));
  const lastJob = useRef<AutomationJob | null>(null);
  const record = recordChoice ?? folderHasFootage === false;
  const recordMinutes = parseRecordMinutes(recordMinutesText);

  // Records the latest job and tells the page when this project's run has just ended
  const applyJob = useCallback(
    (next: AutomationJob | null) => {
      const prev = lastJob.current;
      lastJob.current = next;
      setJob(next);
      if (prev?.State !== next?.State) onStateChange(next?.State ?? null);
      if (prev && next && isActive(prev) && !isActive(next)) onRunFinished();
    },
    [onRunFinished, onStateChange],
  );

  const refresh = useCallback(async () => {
    try {
      applyJob(await getAutomation(projectId));
      setError(null);
    } catch (err) {
      setError(describe(err));
    } finally {
      setLoaded(true);
    }
  }, [projectId, applyJob]);

  useEffect(() => {
    getAutomation(projectId)
      .then(applyJob)
      .catch((err: unknown) => setError(describe(err)))
      .finally(() => setLoaded(true));
  }, [projectId, applyJob]);

  useEffect(() => {
    floorplanLibraryApi
      .getFloorplanLibrary(projectId)
      .then((items) => setFloorplans(items ?? []))
      .catch(() => setFloorplans([]));
  }, [projectId]);

  usePolling(isActive(job), AUTOMATION_POLL_MS, refresh);

  async function act(call: () => Promise<AutomationJob>) {
    setPending(true);
    setError(null);
    try {
      applyJob(await call());
    } catch (err) {
      setError(describe(err));
    } finally {
      setPending(false);
    }
  }

  function confirmCancel() {
    confirmation.confirm({
      header: "Cancel run",
      message: "Cancel the automated calibration run? Footage recorded by this run is deleted and the AMC project is reset to empty. Earlier footage and calibrations are kept.",
      icon: "pi pi-exclamation-triangle",
      rejectButtonStyleClass: "p-button-text",
      acceptLabel: "Cancel run",
      rejectLabel: "Keep going",
      accept: () => void act(() => cancelAutomation(projectId)),
    });
  }

  function start() {
    const floorplan = floorplanId || undefined;
    if (!record) {
      void act(() => startAutomation(projectId, floorplan));
      return;
    }
    if (recordMinutes === null) return;
    const length = `${recordMinutes} minute${recordMinutes === 1 ? "" : "s"}`;
    confirmation.confirm({
      header: "Record new footage",
      message:
        `Start the run by recording ${length} of new footage from every camera? People must walk through every ` +
        "camera's view for the whole recording. It replaces the folder's current footage; one previous recording is " +
        "kept in footage/previous/.",
      icon: "pi pi-exclamation-triangle",
      rejectButtonStyleClass: "p-button-text",
      acceptLabel: "Record and start",
      rejectLabel: "Not yet",
      accept: () => void act(() => startAutomation(projectId, floorplan, { recordSeconds: recordMinutes * 60 })),
    });
  }

  // A refused start, continue or cancel (409) shows the workstation's reason, such as another project's run;
  // a rejected recording request (400) shows its detail the same way
  const canStart = ready && loaded && !pending && !isActive(job) && (!record || recordMinutes !== null);
  const controlsEnabled = ready && loaded && !pending && !isActive(job);
  const canContinue = !pending && !!job && RESUMABLE.includes(job.State);
  const canCancel = !pending && !!job && CANCELLABLE.includes(job.State);

  return (
    <Panel
      title="Automated Calibration"
      actions={
        <>
          <button
            type="button"
            onClick={start}
            disabled={!canStart}
            className={PRIMARY_BUTTON}
          >
            <FontAwesomeIcon icon={faPlay} className="text-xs" />
            Start
          </button>
          <button
            type="button"
            onClick={() => void act(() => continueAutomation(projectId))}
            disabled={!canContinue}
            className={SECONDARY_BUTTON}
          >
            <FontAwesomeIcon icon={faForward} className="text-xs" />
            Continue
          </button>
          <button type="button" onClick={confirmCancel} disabled={!canCancel} className={DANGER_BUTTON}>
            <FontAwesomeIcon icon={faXmark} className="text-xs" />
            Cancel
          </button>
        </>
      }
    >
      {!ready && (
        <p className="text-sm text-ink-muted">Runs start once the project is set up on the workstation.</p>
      )}
      {ready && (
        <div className="flex flex-col gap-4">
          <label className="block max-w-md text-sm font-medium text-ink">
            Floor plan
            <select
              value={floorplanId}
              onChange={(e) => setFloorplanId(e.target.value)}
              disabled={!controlsEnabled}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
            >
              <option value="">Newest floor plan in the project</option>
              {floorplans.map((f) => (
                <option key={f.Id} value={f.Id}>
                  {f.Nickname}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="max-w-md">
            <legend className="sr-only">Footage</legend>
            <div className="flex items-center gap-2">
              <input
                id={`record-footage-${projectId}`}
                type="checkbox"
                checked={record}
                onChange={(e) => setRecordChoice(e.target.checked)}
                disabled={!controlsEnabled}
                aria-describedby={`record-footage-help-${projectId}`}
                className="h-4 w-4 rounded border-slate-300"
              />
              <label htmlFor={`record-footage-${projectId}`} className="text-sm font-medium text-ink">
                Record new footage
              </label>
            </div>
            {record && (
              <div className="mt-3 pl-6">
                <label htmlFor={`record-minutes-${projectId}`} className="block text-sm font-medium text-ink">
                  Length in minutes ({RECORD_MINUTES_MIN} to {RECORD_MINUTES_MAX})
                </label>
                <input
                  id={`record-minutes-${projectId}`}
                  type="number"
                  inputMode="numeric"
                  min={RECORD_MINUTES_MIN}
                  max={RECORD_MINUTES_MAX}
                  step={1}
                  value={recordMinutesText}
                  onChange={(e) => setRecordMinutesText(e.target.value)}
                  disabled={!controlsEnabled}
                  aria-invalid={recordMinutes === null}
                  aria-describedby={recordMinutes === null ? `record-minutes-error-${projectId}` : undefined}
                  className="mt-1 w-28 rounded-md border border-slate-300 px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
                />
                {recordMinutes === null && (
                  <p id={`record-minutes-error-${projectId}`} className="mt-1 text-sm text-red-600">
                    Enter a whole number of minutes from {RECORD_MINUTES_MIN} to {RECORD_MINUTES_MAX}.
                  </p>
                )}
              </div>
            )}
            <p id={`record-footage-help-${projectId}`} className="mt-2 pl-6 text-sm text-ink-muted">
              Step 2 records every camera at once. People must walk through every camera's view for the whole
              recording. The recording replaces the folder's current footage; one previous recording is kept in{" "}
              <span className="font-mono">footage/previous/</span>.
            </p>
          </fieldset>
        </div>
      )}

      <div aria-live="polite">
        {loaded && !job && <p className="mt-4 text-sm text-ink-muted">No automated run for this project yet.</p>}
        {job && <JobDetails job={job} />}
      </div>
      <ErrorText message={error} />
    </Panel>
  );
}

// -- files ------------------------------------------------------------------------------

function FilesPanel({
  projectId,
  reloadKey,
  onFilesLoaded,
}: {
  projectId: string;
  reloadKey: string;
  // Told about each listing that loads, so the run panel can see whether the folder holds footage
  onFilesLoaded: (files: WorkstationFile[]) => void;
}) {
  const [files, setFiles] = useState<WorkstationFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The reloadKey the shown listing answers; loading until it matches the current one
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Only the newest request may update the listing, so a slow older one can't overwrite it
  const latestRequest = useRef(0);
  const loading = refreshing || settledKey !== reloadKey;

  const load = useCallback(
    (key: string) => {
      const request = ++latestRequest.current;
      const isLatest = () => request === latestRequest.current;
      return listProjectFiles(projectId)
        .then((items) => {
          if (!isLatest()) return;
          setFiles(items);
          setError(null);
          onFilesLoaded(items);
        })
        .catch((err: unknown) => {
          if (isLatest()) setError(describe(err));
        })
        .finally(() => {
          if (isLatest()) setSettledKey(key);
        });
    },
    [projectId, onFilesLoaded],
  );

  useEffect(() => {
    void load(reloadKey);
  }, [load, reloadKey]);

  async function refresh() {
    setRefreshing(true);
    await load(reloadKey);
    setRefreshing(false);
  }

  // Resolves the link on click so its ticket is fresh, then lets the browser stream the file to disk
  async function download(path: string) {
    try {
      window.location.assign(await projectFileUrl(projectId, path));
    } catch (err) {
      setError(describe(err));
    }
  }

  return (
    <Panel
      title="Files"
      actions={
        <button type="button" onClick={() => void refresh()} disabled={loading} className={SECONDARY_BUTTON}>
          <FontAwesomeIcon icon={faArrowRotateRight} className="text-xs" />
          Refresh
        </button>
      }
    >
      {files.length === 0 ? (
        <p className="text-sm text-ink-muted">{loading ? "Loading files..." : "The folder has no files yet."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Path</th>
                <th className="py-2 pr-4 font-medium">Size</th>
                <th className="py-2 pr-4 font-medium">Modified</th>
                <th className="py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-ink">
              {files.map((f) => (
                <tr key={f.Path}>
                  <td className="py-2 pr-4 font-mono break-all">{f.Path}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatBytes(f.Size)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatUnix(f.ModifiedAt)}</td>
                  <td className="py-2 text-right">
                    {isDownloadable(f) ? (
                      <button
                        type="button"
                        onClick={() => void download(f.Path)}
                        aria-label={`Download ${f.Path}`}
                        className={SECONDARY_BUTTON}
                      >
                        <FontAwesomeIcon icon={faDownload} className="text-xs" />
                        Download
                      </button>
                    ) : (
                      <span className="text-xs text-ink-muted whitespace-nowrap">Stays on the workstation</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorText message={error} />
    </Panel>
  );
}

// -- page ---------------------------------------------------------------------------------

type Connection =
  | { kind: "loading" }
  | { kind: "ok"; ticket: WorkstationTicket }
  | { kind: "not-configured" }
  | { kind: "mixed-content"; url: string }
  | { kind: "error"; message: string };

function ConnectionNotice({ connection }: { connection: Connection }) {
  if (connection.kind === "loading") return <p className="text-sm text-ink-muted">Connecting to the workstation...</p>;
  if (connection.kind === "not-configured") {
    return (
      <Message
        severity="warn"
        text="Workstation control is not configured on the server. An administrator needs to set WORKSTATION_AMC_URL and WORKSTATION_TICKET_SECRET."
      />
    );
  }
  if (connection.kind === "mixed-content") {
    return (
      <Message
        severity="warn"
        text={`This page is served over HTTPS but the workstation is at ${connection.url}, so the browser blocks the connection. Open the web app over HTTP on the workstation's network, or serve the workstation over HTTPS.`}
      />
    );
  }
  if (connection.kind === "error") return <Message severity="error" text={connection.message} />;
  return null;
}

function CalibrationWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>({ kind: "loading" });

  useEffect(() => {
    projectApi
      .getProject(projectId)
      .then(setProject)
      .catch((err: unknown) => setProjectError(describe(err)));
    requestTicket(projectId)
      .then((ticket) =>
        setConnection(
          isMixedContent(ticket.WorkstationUrl)
            ? { kind: "mixed-content", url: ticket.WorkstationUrl }
            : { kind: "ok", ticket },
        ),
      )
      .catch((err: unknown) =>
        setConnection(isNotConfigured(err) ? { kind: "not-configured" } : { kind: "error", message: describe(err) }),
      );
  }, [projectId]);

  const folder = project?.WorkstationFolder || null;

  return (
    <div>
      <PageHeader
        title="Calibration"
        subtitle="Calibration runs on the workstation, in this project's own folder and AMC project."
      />
      {connection.kind !== "ok" || !project ? (
        <div className="bp-card p-6">
          <ConnectionNotice connection={connection} />
          {connection.kind === "ok" &&
            (projectError ? (
              <Message severity="error" text={`Couldn't load the project. ${projectError}`} />
            ) : (
              <p className="text-sm text-ink-muted">Loading the project...</p>
            ))}
        </div>
      ) : (
        <ConnectedPanels projectId={projectId} folder={folder} ticket={connection.ticket} />
      )}
    </div>
  );
}

function ConnectedPanels({
  projectId,
  folder,
  ticket,
}: {
  projectId: string;
  folder: string | null;
  ticket: WorkstationTicket;
}) {
  const bindingState = useWorkstationBinding(projectId, !!folder);
  const { binding, refresh } = bindingState;
  const onRunFinished = useCallback(() => void refresh(), [refresh]);
  const [runState, setRunState] = useState<AutomationJobState | null>(null);
  const [folderHasFootage, setFolderHasFootage] = useState<boolean | null>(null);
  const onFilesLoaded = useCallback((files: WorkstationFile[]) => setFolderHasFootage(hasFootage(files)), []);

  return (
    <div className="flex flex-col gap-6">
      <WorkstationProjectPanel projectId={projectId} folder={folder} state={bindingState} />
      <AmcPanel projectId={projectId} initialTicket={ticket} runState={runState} />
      <AutomationPanel
        projectId={projectId}
        ready={binding?.State === "ready"}
        folderHasFootage={folderHasFootage}
        onRunFinished={onRunFinished}
        onStateChange={setRunState}
      />
      {binding && (
        <FilesPanel
          projectId={projectId}
          reloadKey={`${binding.State}:${binding.LastRunAt ?? 0}`}
          onFilesLoaded={onFilesLoaded}
        />
      )}
    </div>
  );
}

export function Calibration() {
  const { projectId = "" } = useParams();
  // Keyed so switching projects starts from a clean slate
  return <CalibrationWorkspace key={projectId} projectId={projectId} />;
}

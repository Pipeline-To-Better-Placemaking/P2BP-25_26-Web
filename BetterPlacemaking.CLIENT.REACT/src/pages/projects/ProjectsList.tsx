import { useEffect, useRef, useState } from "react";
import { useConfirm, useDialogService, useToast } from "../../components/prime";
import { DANGER_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../../components/buttonStyles";
import { PageHeader } from "../../components/PageHeader";
import { ProjectCard } from "../../components/ProjectCard";
import { HasPermission } from "../../auth/HasPermission";
import { Permissions } from "../../lib/permissions";
import * as projectApi from "../../services/projectApi";
import type { ProjectDto } from "../../lib/projectTypes";
import { ProjectForm } from "./ProjectForm";
import * as amcApi from "./calibration/amcApi";

const PROVISION_POLL_MS = 3_000;
const PROVISION_POLL_CAP_MS = 30 * 60_000;
// Consecutive polling failures tolerated before reporting and giving up
const PROVISION_POLL_MAX_ERRORS = 5;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ProvisionOutcome =
  | { kind: "settled"; binding: amcApi.WorkstationProject | null }
  | { kind: "timeout" }
  | { kind: "error"; error: unknown }
  | { kind: "stopped" };

// Polls the workstation until the binding leaves "provisioning", the cap passes, or isAlive turns false
async function waitForProvisioning(
  projectId: string,
  result: amcApi.ProvisionResult,
  isAlive: () => boolean,
): Promise<ProvisionOutcome> {
  let binding: amcApi.WorkstationProject | null = result.Binding;
  const deadline = Date.now() + PROVISION_POLL_CAP_MS;
  let errors = 0;
  while (binding?.State === "provisioning") {
    if (Date.now() > deadline) return { kind: "timeout" };
    await delay(PROVISION_POLL_MS);
    if (!isAlive()) return { kind: "stopped" };
    try {
      binding = await amcApi.getWorkstationProject(projectId, result.Ticket);
      errors = 0;
    } catch (err) {
      if (++errors >= PROVISION_POLL_MAX_ERRORS) return { kind: "error", error: err };
    }
  }
  return isAlive() ? { kind: "settled", binding } : { kind: "stopped" };
}

/** Admin "all/manageable projects" console - reused at both /admin/projects and /:projectId/admin/projects. */
export function ProjectsList() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const dialogService = useDialogService();
  const confirmation = useConfirm();
  const toast = useToast();
  // Stops provisioning polls when the page goes away
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function load() {
    projectApi
      .getProjects()
      .then((p) => setProjects(p ?? []))
      .catch(() => setProjects([]));
  }

  useEffect(load, []);

  function reportError(summary: string, err: unknown) {
    toast.add({ severity: "error", summary, detail: amcApi.describeWorkstationError(err), life: 8000 });
  }

  // Sets the project's folder up on the workstation and reports until it is ready or failed.
  // A failure here never touches the web project itself.
  async function provision(projectId: string, folder: string) {
    toast.add({ severity: "info", summary: "Workstation", detail: `Setting up ${folder} on the workstation`, life: 5000 });

    let result: amcApi.ProvisionResult;
    try {
      result = await amcApi.provisionProject(projectId);
    } catch (err) {
      reportError(`Couldn't set up ${folder} on the workstation`, err);
      return;
    }

    const outcome = await waitForProvisioning(projectId, result, () => alive.current);
    if (outcome.kind === "stopped") return;
    if (outcome.kind === "timeout") {
      toast.add({
        severity: "warn",
        summary: "Workstation",
        detail: `${folder} is still being set up; check the Calibration page later.`,
        life: 8000,
      });
      return;
    }
    if (outcome.kind === "error") {
      reportError(`Lost track of setting up ${folder}`, outcome.error);
      return;
    }
    const binding = outcome.binding;

    if (binding?.State === "ready") {
      toast.add({ severity: "success", summary: "Workstation", detail: `${folder} is ready for calibration.`, life: 6000 });
    } else if (binding?.State === "failed") {
      toast.add({
        severity: "error",
        summary: `Setting up ${folder} failed`,
        detail: binding.Error || "The workstation did not say why.",
        sticky: true,
      });
    } else {
      toast.add({ severity: "error", summary: "Workstation", detail: `The workstation has no folder for ${folder}.`, life: 8000 });
    }
  }

  function offerProvision(projectId: string, folder: string) {
    confirmation.confirm({
      header: "Set up on workstation",
      message: `Set up ${folder} on the workstation now?`,
      icon: "pi pi-server",
      rejectButtonStyleClass: "p-button-text",
      acceptLabel: "Set up",
      rejectLabel: "Later",
      accept: () => void provision(projectId, folder),
    });
  }

  const breakpoints = { "960px": "75vw", "640px": "90vw" };

  function addProject() {
    const ref = dialogService.open<ProjectDto | undefined, ProjectDto>(
      ProjectForm,
      {
        header: "Add Project",
        width: "50vw",
        modal: true,
        breakpoints,
        closable: true,
      },
    );
    ref?.onClose.then((project) => {
      if (!project) return;
      projectApi
        .addProject({
          Title: project.Title,
          Description: project.Description,
          Location: project.Location,
          WorkstationFolder: project.WorkstationFolder || null,
        })
        .then((created) => {
          load();
          if (created?.Id && created.WorkstationFolder) void provision(created.Id, created.WorkstationFolder);
        })
        .catch((err) => {
          console.error("Error adding project:", err);
          reportError("Couldn't add the project", err);
        });
    });
  }

  function editProject(project: ProjectDto) {
    const ref = dialogService.open<ProjectDto | undefined, ProjectDto>(
      ProjectForm,
      {
        header: "Edit Project",
        width: "50vw",
        modal: true,
        data: project,
        breakpoints,
        closable: true,
      },
    );
    ref?.onClose.then((updated) => {
      if (!updated) return;
      // The folder is set-once, so it is only sent when this edit sets it
      const newFolder = !project.WorkstationFolder && updated.WorkstationFolder ? updated.WorkstationFolder : undefined;
      projectApi
        .updateProject(updated.Id, {
          Title: updated.Title,
          Description: updated.Description,
          Location: updated.Location,
          ...(newFolder ? { WorkstationFolder: newFolder } : {}),
        })
        .then(() => {
          load();
          if (newFolder) offerProvision(updated.Id, newFolder);
        })
        .catch((err) => {
          console.error("Error updating project:", err);
          reportError("Couldn't update the project", err);
        });
    });
  }

  function deleteProject(project: ProjectDto) {
    if (!project.Id) return;
    confirmation.confirm({
      header: "Delete Project",
      message: `Delete project "${project.Title || project.Id}"? This cannot be undone.`,
      icon: "pi pi-exclamation-triangle",
      acceptButtonStyleClass: "p-button-danger",
      rejectButtonStyleClass: "p-button-text",
      acceptLabel: "Delete",
      rejectLabel: "Cancel",
      accept: () => {
        projectApi
          .deleteProject(project.Id)
          .then(load)
          .catch((err) => console.error("Error deleting project:", err));
      },
    });
  }

  return (
    <div className="w-full">
      <PageHeader
        title={`Manage Projects (${projects.length})`}
        subtitle="Create, edit, and remove projects across the organization."
        actions={
          <HasPermission permission={Permissions.Global.ProjectsCreate}>
            <button type="button" className={PRIMARY_BUTTON} onClick={addProject}>
              <i className="pi pi-plus text-xs" />
              Add Project
            </button>
          </HasPermission>
        }
      />

      {projects.length === 0 ? (
        <div className="bp-card p-6 text-sm text-ink-muted">No projects yet.</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project, i) => (
            <ProjectCard
              key={project.Id}
              project={project}
              // Placeholder status for the visual only: first card online, rest offline
              online={i === 0}
              actions={
                <>
                  <HasPermission permission={Permissions.Project.Update} projectId={project.Id}>
                    <button type="button" className={SECONDARY_BUTTON} onClick={() => editProject(project)}>
                      <i className="pi pi-pencil text-xs" />
                      Edit
                    </button>
                  </HasPermission>
                  <HasPermission permission={Permissions.Project.Delete} projectId={project.Id}>
                    <button type="button" className={DANGER_BUTTON} onClick={() => deleteProject(project)}>
                      <i className="pi pi-trash text-xs" />
                      Delete
                    </button>
                  </HasPermission>
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

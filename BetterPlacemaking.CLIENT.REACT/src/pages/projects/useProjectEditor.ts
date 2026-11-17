import { useEffect, useRef } from "react";
import { useConfirm, useDialogService, useToast } from "../../components/prime";
import * as projectApi from "../../services/projectApi";
import type { ProjectDto } from "../../lib/projectTypes";
import { ProjectForm } from "./ProjectForm";
import * as amcApi from "./calibration/amcApi";

const PROVISION_POLL_MS = 3_000;
const PROVISION_POLL_CAP_MS = 30 * 60_000;
// Consecutive polling failures tolerated before reporting and giving up
const PROVISION_POLL_MAX_ERRORS = 5;

const BREAKPOINTS = { "960px": "75vw", "640px": "90vw" };

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

/**
 * Add, edit and delete flows shared by every page that manages projects, including the
 * workstation folder and its setup on the workstation. `reload` refreshes the page's list.
 */
export function useProjectEditor(reload: () => void) {
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

  function addProject() {
    const ref = dialogService.open<ProjectDto | undefined, ProjectDto>(
      ProjectForm,
      {
        header: "Add Project",
        width: "50vw",
        modal: true,
        breakpoints: BREAKPOINTS,
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
          reload();
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
        breakpoints: BREAKPOINTS,
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
          reload();
          if (newFolder) offerProvision(updated.Id, newFolder);
        })
        .catch((err) => {
          console.error("Error updating project:", err);
          reportError("Couldn't update the project", err);
        });
    });
  }

  // Deletes the web project only, as before the workstation cleanup existed
  async function deleteFromWebApp(project: ProjectDto) {
    try {
      await projectApi.deleteProject(project.Id);
    } catch (err) {
      console.error("Error deleting project:", err);
      reportError("Couldn't delete the project", err);
      return;
    }
    reload();
  }

  // Offered when the workstation could not delete the folder: delete only the web project, or stop
  function offerWebOnlyDelete(project: ProjectDto, folder: string, err: unknown) {
    confirmation.confirm({
      header: "Workstation cleanup failed",
      message:
        `Couldn't delete ${folder} on the workstation: ${amcApi.describeWorkstationError(err).replace(/\.?\s*$/, ".")} ` +
        `Delete from the web app only? The folder and its AMC project stay on the workstation.`,
      icon: "pi pi-exclamation-triangle",
      acceptButtonStyleClass: "p-button-danger",
      rejectButtonStyleClass: "p-button-text",
      acceptLabel: "Delete from the web app only",
      rejectLabel: "Cancel",
      accept: () => void deleteFromWebApp(project),
    });
  }

  // Workstation first, so a failure there leaves the web project in place to retry
  async function deleteWithWorkstation(project: ProjectDto, folder: string) {
    try {
      let startingShown = false;
      const result = await amcApi.deleteWorkstationProject(project.Id, {
        onStartingAmc: () => {
          if (startingShown) return;
          startingShown = true;
          toast.add({
            severity: "info",
            summary: "Workstation",
            detail: `Starting AMC on the workstation to delete ${folder}; this can take a few minutes.`,
            life: 15000,
          });
        },
      });
      if (result?.Leftover) {
        toast.add({
          severity: "warn",
          summary: "Workstation",
          detail: `${folder} was deleted, but ${result.Leftover} could not be removed from the workstation.`,
          life: 10000,
        });
      }
    } catch (err) {
      // Not configured for workstation control: nothing to clean up from here
      if (!amcApi.isNotConfigured(err)) {
        offerWebOnlyDelete(project, folder, err);
        return;
      }
    }
    await deleteFromWebApp(project);
  }

  function deleteProject(project: ProjectDto) {
    if (!project.Id) return;
    const name = project.Title || project.Id;
    const folder = project.WorkstationFolder;
    confirmation.confirm({
      header: "Delete Project",
      message: folder
        ? `Delete project "${name}"? Its workstation folder ${folder} (footage, floor plan, calibrations) and its AMC project are deleted too. This cannot be undone.`
        : `Delete project "${name}"? This cannot be undone.`,
      icon: "pi pi-exclamation-triangle",
      acceptButtonStyleClass: "p-button-danger",
      rejectButtonStyleClass: "p-button-text",
      acceptLabel: "Delete",
      rejectLabel: "Cancel",
      accept: () => void (folder ? deleteWithWorkstation(project, folder) : deleteFromWebApp(project)),
    });
  }

  return { addProject, editProject, deleteProject };
}

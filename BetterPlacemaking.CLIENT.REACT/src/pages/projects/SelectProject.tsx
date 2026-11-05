import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as projectApi from "../../services/projectApi";
import type { ProjectDto } from "../../lib/projectTypes";
import { useConfirm, useDialogService } from "../../components/prime";
import { ProjectForm } from "./ProjectForm";
import { HasPermission } from "../../auth/HasPermission";
import { Permissions } from "../../lib/permissions";
import { PageHeader } from "../../components/PageHeader";
import { ProjectCard } from "../../components/ProjectCard";
import { DANGER_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../../components/buttonStyles";

/**
 * Landing page for any authenticated user - unpermissioned route, server-side
 * filtered response (GET /api/project returns "my projects" for a non-admin,
 * "every project" for someone with Global.Projects.ReadAll). No Add/Edit/Delete
 * here, matching the Angular SelectProject component.
 */
export function SelectProject() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [managing, setManaging] = useState(false);
  const dialogService = useDialogService();
  const confirmation = useConfirm();

  function load() {
    projectApi
      .getProjects()
      .then((p) => setProjects(p ?? []))
      .catch(() => setProjects([]));
  }

  useEffect(load, []);

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
        })
        .then(load)
        .catch((err) => console.error("Error adding project:", err));
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
      projectApi
        .updateProject(updated.Id, {
          Title: updated.Title,
          Description: updated.Description,
          Location: updated.Location,
        })
        .then(load)
        .catch((err) => console.error("Error updating project:", err));
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
        title="Projects"
        subtitle="Select a project to view its dashboard, devices, and calibration."
        actions={
          !managing ? (
            <HasPermission permission={Permissions.Global.ProjectsReadAll}>
              <button type="button" className={PRIMARY_BUTTON} onClick={() => setManaging(true)}>
                Manage Projects
              </button>
            </HasPermission>
          ) : (
            <>
              <button type="button" className={PRIMARY_BUTTON} onClick={addProject}>
                Add Project
              </button>
              <button type="button" className={SECONDARY_BUTTON} onClick={() => setManaging(false)}>
                Done
              </button>
            </>
          )
        }
      />

      {projects.length === 0 ? (
        <p className="text-sm text-ink-muted">No projects assigned.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project, i) => (
            <ProjectCard
              key={project.Id}
              project={project}
              // Placeholder status for the visual only: first card online, rest offline
              online={i === 0}
              actions={
                !managing ? (
                  <Link to={`/${project.Id}`} className={PRIMARY_BUTTON}>
                    Open Project
                  </Link>
                ) : (
                  <HasPermission permission={Permissions.Project.Update} projectId={project.Id}>
                    <button type="button" className={SECONDARY_BUTTON} onClick={() => editProject(project)}>
                      Edit
                    </button>
                    <button type="button" className={DANGER_BUTTON} onClick={() => deleteProject(project)}>
                      Delete
                    </button>
                  </HasPermission>
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

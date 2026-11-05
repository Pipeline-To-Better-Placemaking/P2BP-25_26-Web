import { useEffect, useState } from "react";
import { useConfirm, useDialogService } from "../../components/prime";
import { DANGER_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../../components/buttonStyles";
import { PageHeader } from "../../components/PageHeader";
import { ProjectCard } from "../../components/ProjectCard";
import { HasPermission } from "../../auth/HasPermission";
import { Permissions } from "../../lib/permissions";
import * as projectApi from "../../services/projectApi";
import type { ProjectDto } from "../../lib/projectTypes";
import { ProjectForm } from "./ProjectForm";

/** Admin "all/manageable projects" console - reused at both /admin/projects and /:projectId/admin/projects. */
export function ProjectsList() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
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

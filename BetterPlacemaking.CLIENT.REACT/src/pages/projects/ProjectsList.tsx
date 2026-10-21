import { useEffect, useState } from "react";
import { Button, useConfirm, useDialogService } from "../../components/prime";
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
    <div className="w-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-xl">Projects</span>
          <span className="text-muted-color text-xl">
            {projects.length || 0}
          </span>
        </div>
        <HasPermission permission={Permissions.Global.ProjectsCreate}>
          <Button label="Add" icon="pi pi-plus" onClick={addProject} />
        </HasPermission>
      </div>

      {/* Cards */}
      {projects.length === 0 ? (
        <p>No projects.</p>
      ) : (
        <div className="flex flex-wrap gap-5">
          {projects.map((project, i) => (
            <ManageProjectCard
              key={project.Id}
              project={project}
              // Placeholder status for the visual only: first card online, rest offline
              online={i === 0}
              onEdit={() => editProject(project)}
              onDelete={() => deleteProject(project)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs opacity-70 border-b border-gray-400 pb-0.5">
        {label}
      </span>
      <span className="text-sm py-1 min-h-[2.5rem]">{children}</span>
    </div>
  );
}

function ManageProjectCard({
  project,
  online,
  onEdit,
  onDelete,
}: {
  project: ProjectDto;
  online: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-white dark:bg-[#18181B] rounded-lg shadow-sm p-4 w-[240px] flex flex-col gap-3">
      <h3 className="font-semibold text-lg">{project.Title}</h3>

      <Field label="Description">{project.Description}</Field>
      <Field label="Location">{project.Location}</Field>

      <div className="flex flex-col">
        <span className="text-xs opacity-70 border-b border-gray-400 pb-0.5">
          Device Status:
        </span>
        <div className="flex justify-between items-center py-1">
          <span className="text-sm">{online ? "Online" : "Offline"}</span>
          <span
            className={`inline-block w-3 h-3 rounded-full ${online ? "bg-green-500" : "bg-red-500"}`}
            aria-label={online ? "Online" : "Offline"}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-auto">
        <HasPermission
          permission={Permissions.Project.Update}
          projectId={project.Id}
        >
          <Button
            label="Edit"
            icon="pi pi-pencil"
            severity="secondary"
            size="small"
            onClick={onEdit}
          />
        </HasPermission>
        <HasPermission
          permission={Permissions.Project.Delete}
          projectId={project.Id}
        >
          <Button
            label="Delete"
            icon="pi pi-trash"
            severity="danger"
            size="small"
            onClick={onDelete}
          />
        </HasPermission>
      </div>
    </div>
  );
}

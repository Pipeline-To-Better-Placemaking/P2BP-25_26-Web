import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as projectApi from "../../services/projectApi";
import type { ProjectDto } from "../../lib/projectTypes";
import { useConfirm, useDialogService } from "../../components/prime";
import { ProjectForm } from "./ProjectForm";
import { HasPermission } from "../../auth/HasPermission";
import { Permissions } from "../../lib/permissions";

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
    <div className="w-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <span className="font-semibold text-[#35404F] text-xl">Projects</span>
        {!managing ? (
          <HasPermission permission={Permissions.Global.ProjectsReadAll}>
            <button
              type="button"
              className="p-button p-component p-button-sm font-semibold bg-white"
              onClick={() => setManaging(true)}
            >
              Manage Projects
            </button>
          </HasPermission>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              className="p-button p-component p-button-sm font-semibold"
              onClick={addProject}
            >
              Add
            </button>
            <button
              type="button"
              className="p-button p-component p-button-sm p-button-outlined p-button-secondary"
              onClick={() => setManaging(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Cards */}
      {projects.length === 0 ? (
        <p>No projects assigned.</p>
      ) : (
        <div className="flex flex-wrap gap-5">
          {projects.map((project, i) => (
            <ProjectCard
              key={project.Id}
              project={project}
              managing={managing}
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

function ProjectCard({
  project,
  managing,
  online,
  onEdit,
  onDelete,
}: {
  project: ProjectDto;
  managing: boolean;
  online: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-white dark:bg-[#18181B] text-[#475569] rounded-lg shadow-sm p-4 w-[240px] flex flex-col gap-3">
      <h3 className="font-semibold text-lg text-[#35404F]">{project.Title}</h3>

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

      {/* Buttons */}
      <div className="flex justify-end gap-2 mt-auto">
        {!managing ? (
          <Link
            to={`/${project.Id}`}
            className="p-button p-component p-button-sm p-button-outlined"
          >
            Open
          </Link>
        ) : (
          <>
            <HasPermission
              permission={Permissions.Project.Update}
              projectId={project.Id}
            >
              <button
                type="button"
                className="p-button p-component p-button-sm p-button-outlined font-semibold"
                onClick={onEdit}
              >
                Edit
              </button>
              <button
                type="button"
                className="p-button p-component p-button-sm font-semibold p-button-danger"
                onClick={onDelete}
              >
                Delete
              </button>
            </HasPermission>
          </>
        )}
      </div>
    </div>
  );
}

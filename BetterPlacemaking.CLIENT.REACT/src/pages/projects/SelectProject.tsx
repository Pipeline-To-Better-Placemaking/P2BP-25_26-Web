import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as projectApi from "../../services/projectApi";
import type { ProjectDto } from "../../lib/projectTypes";
import { useProjectEditor } from "./useProjectEditor";
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

  function load() {
    projectApi
      .getProjects()
      .then((p) => setProjects(p ?? []))
      .catch(() => setProjects([]));
  }

  useEffect(load, []);

  const { addProject, editProject, deleteProject } = useProjectEditor(load);

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

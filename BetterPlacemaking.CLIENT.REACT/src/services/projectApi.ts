import { api } from "../auth/apiClient";
import type { ProjectDto } from "../lib/projectTypes";

export interface ProjectInput {
  Title?: string;
  Description?: string;
  Location?: string;
  /** null or "" means no folder; set-once on update (omit to leave it alone). */
  WorkstationFolder?: string | null;
}

export function getProjects(): Promise<ProjectDto[]> {
  return api.get<ProjectDto[]>("/api/project");
}

export function getProject(id: string): Promise<ProjectDto> {
  return api.get<ProjectDto>(`/api/project/${id}`);
}

export function addProject(project: ProjectInput): Promise<ProjectDto> {
  return api.post<ProjectDto>("/api/project", project);
}

export function updateProject(id: string, project: ProjectInput): Promise<void> {
  return api.put<void>(`/api/project/${id}`, project);
}

export function deleteProject(id: string): Promise<void> {
  return api.delete<void>(`/api/project/${id}`);
}

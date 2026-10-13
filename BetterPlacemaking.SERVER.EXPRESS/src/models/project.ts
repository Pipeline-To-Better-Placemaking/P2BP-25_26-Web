/** API shape for projects - PascalCase, unchanged from the ASP.NET server (backed by the `projects` table). */
export interface ProjectDoc {
  Title?: string | null;
  Description?: string | null;
  Location?: string | null;
}

export interface Project extends ProjectDoc {
  Id: string;
}

export interface ProjectDto {
  Id?: string;
  Title?: string | null;
  Description?: string | null;
  Location?: string | null;
}

export function toProjectDto(project: Project): ProjectDto {
  return {
    Id: project.Id,
    Title: project.Title ?? null,
    Description: project.Description ?? null,
    Location: project.Location ?? null,
  };
}

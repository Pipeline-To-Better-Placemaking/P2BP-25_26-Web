import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { projectMembers, projects } from "../db/schema/index.js";
import type { Project } from "../models/project.js";

type ProjectRow = typeof projects.$inferSelect;

function toProject(row: ProjectRow): Project {
  return { Id: row.id, Title: row.title, Description: row.description, Location: row.location };
}

export async function getAll(): Promise<Project[]> {
  const rows = await getDb().select().from(projects);
  return rows.map(toProject);
}

export async function getById(id: string): Promise<Project | null> {
  if (!id) return null;
  const [row] = await getDb().select().from(projects).where(eq(projects.id, id)).limit(1);
  return row ? toProject(row) : null;
}

export interface CreateProjectInput {
  Title?: string | null;
  Description?: string | null;
  Location?: string | null;
}

/**
 * Creates the project and, as a fix over the ASP.NET server (see migration plan),
 * bootstraps the creator's membership so they aren't immediately locked out of a
 * project they just made - writes the same member-row shape roleAssignmentService
 * already uses (roles/authzVersion) with the seeded ProjectOwner role.
 */
export async function create(input: CreateProjectInput, creatorUserId: string): Promise<Project> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({
        title: input.Title ?? null,
        description: input.Description ?? null,
        location: input.Location ?? null,
      })
      .returning();
    await tx.insert(projectMembers).values({
      projectId: row.id,
      userId: creatorUserId,
      roles: ["ProjectOwner"],
      authzVersion: 1,
    });
    return toProject(row);
  });
}

/** Full-field overwrite of Title/Description/Location every call - matches the ASP.NET server (not a partial PATCH). */
export async function update(id: string, input: CreateProjectInput): Promise<boolean> {
  const rows = await getDb()
    .update(projects)
    .set({
      title: input.Title ?? null,
      description: input.Description ?? null,
      location: input.Location ?? null,
    })
    .where(eq(projects.id, id))
    .returning({ id: projects.id });
  return rows.length > 0;
}

/** Deletes the project row (members cascade via FK); no other cleanup - matches the ASP.NET server. */
export async function deleteProject(id: string): Promise<boolean> {
  const rows = await getDb().delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
  return rows.length > 0;
}

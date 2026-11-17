import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { projectMembers, projects } from "../db/schema/index.js";
import type { Project } from "../models/project.js";

type ProjectRow = typeof projects.$inferSelect;

function toProject(row: ProjectRow): Project {
  return {
    Id: row.id,
    Title: row.title,
    Description: row.description,
    Location: row.location,
    WorkstationFolder: row.workstationFolder,
  };
}

/** A workstation folder that is taken by another project, or a change to one already set; maps to 409. */
export class WorkstationFolderConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkstationFolderConflictError";
  }
}

const UNIQUE_VIOLATION = "23505";

/** Postgres unique violation, raw (postgres-js, PGlite) or wrapped by drizzle in `cause`. */
function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 3 && e && typeof e === "object"; depth++) {
    if ((e as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

function folderTaken(folder: string): WorkstationFolderConflictError {
  return new WorkstationFolderConflictError(`Workstation folder "${folder}" is already used by another project.`);
}

async function assertFolderFree(folder: string, exceptProjectId?: string): Promise<void> {
  const where = exceptProjectId
    ? and(eq(projects.workstationFolder, folder), ne(projects.id, exceptProjectId))
    : eq(projects.workstationFolder, folder);
  const [taken] = await getDb().select({ id: projects.id }).from(projects).where(where).limit(1);
  if (taken) throw folderTaken(folder);
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
  /** Already validated by the route (models/workstationFolder.ts); null = no folder. */
  WorkstationFolder?: string | null;
}

/**
 * Creates the project and, as a fix over the ASP.NET server (see migration plan),
 * bootstraps the creator's membership so they aren't immediately locked out of a
 * project they just made - writes the same member-row shape roleAssignmentService
 * already uses (roles/authzVersion) with the seeded ProjectOwner role.
 */
export async function create(input: CreateProjectInput, creatorUserId: string): Promise<Project> {
  const folder = input.WorkstationFolder ?? null;
  if (folder) await assertFolderFree(folder);
  try {
    return await insertWithOwner(input, folder, creatorUserId);
  } catch (err) {
    if (folder && isUniqueViolation(err)) throw folderTaken(folder);
    throw err;
  }
}

function insertWithOwner(input: CreateProjectInput, folder: string | null, creatorUserId: string): Promise<Project> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({
        title: input.Title ?? null,
        description: input.Description ?? null,
        location: input.Location ?? null,
        workstationFolder: folder,
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

/**
 * Full-field overwrite of Title/Description/Location every call - matches the ASP.NET server (not a partial PATCH).
 * WorkstationFolder is set-once: undefined leaves it alone, the stored value is a no-op, a new value is accepted
 * only while the stored one is null, and anything else throws WorkstationFolderConflictError.
 */
export async function update(id: string, input: CreateProjectInput): Promise<boolean> {
  const fields: Partial<typeof projects.$inferInsert> = {
    title: input.Title ?? null,
    description: input.Description ?? null,
    location: input.Location ?? null,
  };

  const folder = input.WorkstationFolder;
  if (folder !== undefined) {
    const [current] = await getDb()
      .select({ workstationFolder: projects.workstationFolder })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    if (!current) return false;
    const stored = current.workstationFolder;
    if (folder !== stored) {
      if (stored !== null) {
        throw new WorkstationFolderConflictError(
          `Workstation folder is already set to "${stored}" and cannot be changed.`,
        );
      }
      // folder is non-null here: null === stored was handled above.
      await assertFolderFree(folder as string, id);
      fields.workstationFolder = folder;
    }
  }

  const setsFolder = fields.workstationFolder !== undefined;
  try {
    const rows = await getDb()
      .update(projects)
      .set(fields)
      // Guard the set-once rule against a concurrent writer: only fill a folder that is still null.
      .where(setsFolder ? and(eq(projects.id, id), isNull(projects.workstationFolder)) : eq(projects.id, id))
      .returning({ id: projects.id });
    if (rows.length > 0) return true;
    if (!setsFolder) return false;
    if (!(await getById(id))) return false;
    throw new WorkstationFolderConflictError("Workstation folder was set concurrently and cannot be changed.");
  } catch (err) {
    if (setsFolder && isUniqueViolation(err)) throw folderTaken(fields.workstationFolder as string);
    throw err;
  }
}

/** Deletes the project row (members cascade via FK); no other cleanup - matches the ASP.NET server. */
export async function deleteProject(id: string): Promise<boolean> {
  const rows = await getDb().delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
  return rows.length > 0;
}

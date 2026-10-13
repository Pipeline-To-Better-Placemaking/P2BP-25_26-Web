import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { roleDefinitionsGlobal, roleDefinitionsProject } from "../db/schema/index.js";
import { Permissions } from "./permissions.js";

interface SeedEntry {
  table: typeof roleDefinitionsGlobal | typeof roleDefinitionsProject;
  roleName: string;
  permissions: string[];
}

const SEED_ROLES: SeedEntry[] = [
  { table: roleDefinitionsGlobal, roleName: "SuperAdmin", permissions: [...Permissions.Global.All, ...Permissions.Project.All] },
  { table: roleDefinitionsGlobal, roleName: "Admin", permissions: [...Permissions.Global.All, ...Permissions.Project.All] },
  { table: roleDefinitionsProject, roleName: "ProjectAdmin", permissions: Permissions.Project.Admin },
  { table: roleDefinitionsProject, roleName: "ProjectOwner", permissions: Permissions.Project.Admin },
  { table: roleDefinitionsProject, roleName: "ProjectViewer", permissions: Permissions.Project.Viewer },
  { table: roleDefinitionsProject, roleName: "ProjectEditor", permissions: Permissions.Project.Editor },
];

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    seen.set(value.toLowerCase(), value);
  }
  return Array.from(seen.values());
}

/**
 * Idempotently upserts the system role definitions on startup. If an admin has
 * hand-edited a role row and explicitly set is_system = false, that row is left
 * alone - this only ever protects/refreshes rows that are still system-owned.
 */
export async function seedRoles(): Promise<void> {
  const db = getDb();

  for (const entry of SEED_ROLES) {
    const { table } = entry;
    await db
      .insert(table)
      .values({
        name: entry.roleName,
        permissions: dedupeCaseInsensitive(entry.permissions),
        isSystem: true,
      })
      .onConflictDoUpdate({
        target: table.name,
        set: {
          permissions: dedupeCaseInsensitive(entry.permissions),
          isSystem: true,
          updatedAt: new Date(),
        },
        setWhere: sql`${table.isSystem} = true`,
      });
  }
}

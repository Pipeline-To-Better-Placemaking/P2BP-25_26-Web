import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, setDbForTesting } from "./client.js";
import { projectMembers, projects, users } from "./schema/index.js";
import { createTestDb } from "../test/db.js";

describe("core schema (PGlite)", () => {
  afterEach(() => setDbForTesting(null));

  it("creates, inserts and selects", async () => {
    await createTestDb();
    const db = getDb();
    const [u] = await db.insert(users).values({ email: "a@b.c" }).returning();
    const [p] = await db.insert(projects).values({ title: "P" }).returning();
    await db.insert(projectMembers).values({ projectId: p.id, userId: u.id, roles: ["ProjectOwner"] });

    const rows = await db.select().from(projectMembers).where(eq(projectMembers.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].roles).toEqual(["ProjectOwner"]);
    await expect(db.insert(users).values({ email: "a@b.c" })).rejects.toThrow();
  });
});

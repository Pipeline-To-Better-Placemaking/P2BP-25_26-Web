import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDbForTesting, type Db } from "../db/client.js";
import { projectMembers, users } from "../db/schema/index.js";
import { createTestDb } from "../test/db.js";
import * as projectService from "./projectService.js";

let db: Db;

async function makeUser(id: string) {
  await db.insert(users).values({ id, email: `${id}@example.com` });
}

beforeAll(async () => {
  db = await createTestDb();
  await makeUser("creator-user-1");
  await makeUser("creator-user-2");
  await makeUser("u1");
});
afterAll(() => setDbForTesting(null));

function member(projectId: string, userId: string) {
  return db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}

describe("projectService.create", () => {
  it("bootstraps the creator's ProjectOwner membership (migration fix)", async () => {
    const project = await projectService.create(
      { Title: "Test Project", Description: "d", Location: "l" },
      "creator-user-1",
    );

    expect(project.Title).toBe("Test Project");

    const [row] = await member(project.Id, "creator-user-1");
    expect(row).toBeDefined();
    expect(row.roles).toEqual(["ProjectOwner"]);
    expect(row.authzVersion).toBe(1);
  });

  it("does not bootstrap membership for any other user", async () => {
    const project = await projectService.create({ Title: "Another" }, "creator-user-2");
    expect(await member(project.Id, "some-other-user")).toHaveLength(0);
  });
});

describe("projectService.update", () => {
  it("overwrites all three fields every call, nulling out omitted ones", async () => {
    const project = await projectService.create({ Title: "T", Description: "D", Location: "L" }, "u1");
    const success = await projectService.update(project.Id, { Title: "New Title" });
    expect(success).toBe(true);

    const doc = await projectService.getById(project.Id);
    expect(doc?.Title).toBe("New Title");
    expect(doc?.Description ?? null).toBeNull();
    expect(doc?.Location ?? null).toBeNull();
  });

  it("returns false for a nonexistent project", async () => {
    const success = await projectService.update("does-not-exist", { Title: "x" });
    expect(success).toBe(false);
  });
});

describe("projectService.deleteProject", () => {
  it("deletes the project and cascades members", async () => {
    const project = await projectService.create({ Title: "Del" }, "u1");
    expect(await projectService.deleteProject(project.Id)).toBe(true);
    expect(await projectService.getById(project.Id)).toBeNull();
    expect(await member(project.Id, "u1")).toHaveLength(0);
    expect(await projectService.deleteProject(project.Id)).toBe(false);
  });
});

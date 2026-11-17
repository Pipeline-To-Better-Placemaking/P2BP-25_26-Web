import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createTestDb } from "../test/db.js";
import { projects, users } from "../db/schema/index.js";

const db = await createTestDb();
const hasGlobalPermission = vi.fn(async () => false);
const hasProjectPermission = vi.fn(async (_userId: string, _role: string | undefined, projectId: string) => projectId === "readable-project");

vi.mock("../authorization/authorizationService.js", () => ({
  hasGlobalPermission: (...args: unknown[]) => hasGlobalPermission(...(args as [string, string | undefined, string])),
  hasProjectPermission: (...args: unknown[]) =>
    hasProjectPermission(...(args as [string, string | undefined, string, string])),
  getEffectiveGlobalPermissions: async () => [],
  getEffectiveProjectPermissions: async () => [],
  getProjectRoleOptions: async () => [],
}));

const { createApp } = await import("../app.js");
const { createUserToken } = await import("../services/tokenService.js");

function authHeader(): string {
  const { token } = createUserToken({ Id: "user-1", Email: "a@b.com", Role: "User" } as never);
  return `Bearer ${token}`;
}

describe("GET /api/project (permission-filtered list)", () => {
  it("returns only projects the user has Project.Read on when they lack Global.Projects.ReadAll", async () => {
    await db.insert(projects).values({ id: "readable-project", title: "Readable" });
    await db.insert(projects).values({ id: "hidden-project", title: "Hidden" });

    const app = createApp();
    const res = await request(app).get("/api/project").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].Title).toBe("Readable");
  });

  it("returns every project when the user has Global.Projects.ReadAll", async () => {
    hasGlobalPermission.mockResolvedValueOnce(true);

    const app = createApp();
    const res = await request(app).get("/api/project").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });
});

describe("WorkstationFolder on /api/project", () => {
  beforeAll(async () => {
    await db.insert(users).values({ id: "user-1", email: "a@b.com" });
  });
  beforeEach(() => {
    hasGlobalPermission.mockResolvedValue(true);
    hasProjectPermission.mockResolvedValue(true);
  });
  afterEach(() => {
    hasGlobalPermission.mockReset();
    hasGlobalPermission.mockImplementation(async () => false);
    hasProjectPermission.mockReset();
    hasProjectPermission.mockImplementation(async (_u, _r, projectId) => projectId === "readable-project");
  });

  async function createProject(body: Record<string, unknown>) {
    return request(createApp()).post("/api/project").set("Authorization", authHeader()).send(body);
  }
  async function updateProject(id: string, body: Record<string, unknown>) {
    return request(createApp()).put(`/api/project/${id}`).set("Authorization", authHeader()).send(body);
  }
  async function storedFolder(id: string) {
    const res = await request(createApp()).get(`/api/project/${id}`).set("Authorization", authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("WorkstationFolder");
    return res.body.WorkstationFolder;
  }

  it("creates a project with a folder and returns it on the DTO", async () => {
    const res = await createProject({ Title: "Lake Eola", WorkstationFolder: "lake-eola" });
    expect(res.status).toBe(200);
    expect(res.body.WorkstationFolder).toBe("lake-eola");
    expect(await storedFolder(res.body.Id)).toBe("lake-eola");
  });

  it("stores null when the folder is absent or empty", async () => {
    const absent = await createProject({ Title: "No folder" });
    expect(absent.status).toBe(200);
    expect(absent.body.WorkstationFolder).toBeNull();

    const empty = await createProject({ Title: "Empty folder", WorkstationFolder: "" });
    expect(empty.status).toBe(200);
    expect(empty.body.WorkstationFolder).toBeNull();
  });

  it("lists projects with the WorkstationFolder field", async () => {
    const res = await request(createApp()).get("/api/project").set("Authorization", authHeader());
    expect(res.status).toBe(200);
    for (const p of res.body) expect(p).toHaveProperty("WorkstationFolder");
  });

  it.each(["Lake-Eola", "-lake", "lake-", "lake_eola", "lake eola", "a".repeat(49), 42])(
    "rejects an invalid folder %s with 400",
    async (folder) => {
      const res = await createProject({ Title: "Bad", WorkstationFolder: folder });
      expect(res.status).toBe(400);
    },
  );

  it("accepts the boundary lengths 1 and 48", async () => {
    expect((await createProject({ WorkstationFolder: "x" })).status).toBe(200);
    expect((await createProject({ WorkstationFolder: "b".repeat(48) })).status).toBe(200);
  });

  it("refuses a duplicate folder on create with 409", async () => {
    expect((await createProject({ WorkstationFolder: "dup-create" })).status).toBe(200);
    const res = await createProject({ WorkstationFolder: "dup-create" });
    expect(res.status).toBe(409);
    expect(res.body.Message).toContain("dup-create");
  });

  it("sets the folder once on update, then treats the same value as a no-op", async () => {
    const { body } = await createProject({ Title: "Later" });
    expect((await updateProject(body.Id, { Title: "Later", WorkstationFolder: "set-later" })).status).toBe(200);
    expect(await storedFolder(body.Id)).toBe("set-later");

    expect((await updateProject(body.Id, { Title: "Renamed", WorkstationFolder: "set-later" })).status).toBe(200);
    expect((await updateProject(body.Id, { Title: "Renamed again" })).status).toBe(200);
    expect(await storedFolder(body.Id)).toBe("set-later");
  });

  it("refuses to change or clear a folder once set with 409", async () => {
    const { body } = await createProject({ WorkstationFolder: "fixed" });
    expect((await updateProject(body.Id, { WorkstationFolder: "other" })).status).toBe(409);
    expect((await updateProject(body.Id, { WorkstationFolder: "" })).status).toBe(409);
    expect((await updateProject(body.Id, { WorkstationFolder: null })).status).toBe(409);
    expect(await storedFolder(body.Id)).toBe("fixed");
  });

  it("validates and dedupes the folder on update", async () => {
    await createProject({ WorkstationFolder: "taken" });
    const { body } = await createProject({ Title: "Unset" });
    expect((await updateProject(body.Id, { WorkstationFolder: "Not Valid" })).status).toBe(400);
    expect((await updateProject(body.Id, { WorkstationFolder: "taken" })).status).toBe(409);
    expect(await storedFolder(body.Id)).toBeNull();
  });

  it("returns 404 when updating the folder of a missing project", async () => {
    expect((await updateProject("missing-project", { WorkstationFolder: "ghost" })).status).toBe(404);
  });
});

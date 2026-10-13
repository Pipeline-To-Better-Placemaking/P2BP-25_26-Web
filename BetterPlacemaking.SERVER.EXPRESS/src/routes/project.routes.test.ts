import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createTestDb } from "../test/db.js";
import { projects } from "../db/schema/index.js";

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

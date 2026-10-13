import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db.js";
import { projects, scanSchedules } from "../db/schema/index.js";
import type { Db } from "../db/client.js";

const hasGlobalPermission = vi.fn(async () => false);
const hasProjectPermission = vi.fn(
  async (_userId: string, _role: string | undefined, projectId: string) => projectId === "proj-1",
);

vi.mock("../authorization/authorizationService.js", () => ({
  hasGlobalPermission: (...args: unknown[]) => hasGlobalPermission(...(args as [string, string | undefined, string])),
  hasProjectPermission: (...args: unknown[]) =>
    hasProjectPermission(...(args as [string, string | undefined, string, string])),
  getEffectiveGlobalPermissions: async () => [],
  getEffectiveProjectPermissions: async () => [],
  getProjectRoleOptions: async () => [],
}));

// Not wired into app.ts yet (another migration step mounts it), so the test builds a
// minimal app around the router directly - same middleware stack app.ts uses.
const { scanScheduleRouter } = await import("./scanSchedule.routes.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { createUserToken } = await import("../services/tokenService.js");

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(projects).values([
    { id: "proj-1", title: "P1" },
    { id: "proj-list", title: "PL" },
    { id: "proj-2", title: "P2" },
  ]);
});

async function peekSchedule(id: string) {
  const [row] = await db.select().from(scanSchedules).where(eq(scanSchedules.id, id));
  return row;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/scan-schedule", scanScheduleRouter);
  app.use(errorHandler);
  return app;
}

function authHeader(): string {
  const { token } = createUserToken({ Id: "user-1", Email: "a@b.com", Role: "User" } as never);
  return `Bearer ${token}`;
}

describe("POST /api/scan-schedule/:projectId", () => {
  it("creates a schedule, server-assigning CreatedAt/CreatedByUserId and ignoring client-sent ones", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/scan-schedule/proj-1")
      .set("Authorization", authHeader())
      .send({ StartDate: "2026-01-01", StartTime: "09:00", Frequency: "Daily", CreatedByUserId: "attacker" });

    expect(res.status).toBe(200);
    expect(res.body.Id).toBeTruthy();

    const stored = await peekSchedule(res.body.Id);
    expect(stored?.projectId).toBe("proj-1");
    expect(stored?.startDate).toBe("2026-01-01");
    expect(stored?.frequency).toBe("Daily");
    expect(stored?.createdByUserId).toBe("user-1");
    expect(stored?.createdAt).toBeTruthy();
  });

  it("denies creation when the caller lacks Project.ScanSchedules.Manage on the project", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/scan-schedule/proj-2")
      .set("Authorization", authHeader())
      .send({ StartDate: "2026-01-01" });

    expect(res.status).toBe(403);
  });
});

describe("GET /api/scan-schedule/:projectId", () => {
  it("lists the schedules for the project", async () => {
    hasProjectPermission.mockImplementationOnce(async (_u, _r, projectId: string) => projectId === "proj-list");
    await db.insert(scanSchedules).values({
      id: "sched-1",
      projectId: "proj-list",
      startDate: "2026-02-01",
      frequency: "Weekly",
    });
    await db.insert(scanSchedules).values({ id: "sched-other", projectId: "proj-1", frequency: "Daily" });

    const app = buildApp();
    const res = await request(app).get("/api/scan-schedule/proj-list").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].Id).toBe("sched-1");
    expect(res.body[0].Frequency).toBe("Weekly");
    expect(typeof res.body[0].CreatedAt).toBe("string");
    expect(res.body[0].LastRunAt).toBeNull();
  });

  it("denies listing when the caller lacks Project.ScanSchedules.Read on the project", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/scan-schedule/proj-2").set("Authorization", authHeader());

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/scan-schedule/:projectId/:scheduleId", () => {
  it("deletes an existing schedule", async () => {
    await db.insert(scanSchedules).values({ id: "sched-del", projectId: "proj-1", frequency: "Daily" });

    const app = buildApp();
    const res = await request(app)
      .delete("/api/scan-schedule/proj-1/sched-del")
      .set("Authorization", authHeader());

    expect(res.status).toBe(204);
    expect(await peekSchedule("sched-del")).toBeUndefined();
  });

  it("returns 404 for a schedule that does not exist", async () => {
    const app = buildApp();
    const res = await request(app)
      .delete("/api/scan-schedule/proj-1/does-not-exist")
      .set("Authorization", authHeader());

    expect(res.status).toBe(404);
  });

  it("denies deletion when the caller lacks Project.ScanSchedules.Manage on the project", async () => {
    const app = buildApp();
    const res = await request(app)
      .delete("/api/scan-schedule/proj-2/sched-1")
      .set("Authorization", authHeader());

    expect(res.status).toBe(403);
  });
});

describe("PUT /api/scan-schedule/:projectId/:scheduleId", () => {
  it("updates provided fields and always resets EndDate/EndTime, defaulting to empty string when omitted", async () => {
    await db.insert(scanSchedules).values({
      id: "sched-put",
      projectId: "proj-1",
      startDate: "2026-01-01",
      startTime: "09:00",
      frequency: "Daily",
      endDate: "2026-06-01",
      endTime: "17:00",
    });

    const app = buildApp();
    const res = await request(app)
      .put("/api/scan-schedule/proj-1/sched-put")
      .set("Authorization", authHeader())
      .send({ Frequency: "Weekly" });

    expect(res.status).toBe(204);

    const stored = await peekSchedule("sched-put");
    expect(stored?.frequency).toBe("Weekly");
    expect(stored?.startDate).toBe("2026-01-01");
    expect(stored?.endDate).toBe("");
    expect(stored?.endTime).toBe("");
  });

  it("returns 404 for a schedule that does not exist", async () => {
    const app = buildApp();
    const res = await request(app)
      .put("/api/scan-schedule/proj-1/does-not-exist")
      .set("Authorization", authHeader())
      .send({ Frequency: "Weekly" });

    expect(res.status).toBe(404);
  });

  it("denies updates when the caller lacks Project.ScanSchedules.Manage on the project", async () => {
    const app = buildApp();
    const res = await request(app)
      .put("/api/scan-schedule/proj-2/sched-1")
      .set("Authorization", authHeader())
      .send({ Frequency: "Weekly" });

    expect(res.status).toBe(403);
  });
});

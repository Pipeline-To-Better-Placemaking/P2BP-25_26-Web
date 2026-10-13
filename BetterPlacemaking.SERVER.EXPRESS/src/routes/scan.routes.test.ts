import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "../test/db.js";
import { devices, projects, scans } from "../db/schema/index.js";
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

// Not wired into app.ts yet (another migration step mounts it), so the test builds a minimal
// app around the router directly - same middleware stack app.ts uses (see scanSchedule.routes.test.ts).
const { scanRouter } = await import("./scan.routes.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { createUserToken } = await import("../services/tokenService.js");

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(projects).values([
    { id: "proj-1", title: "P1" },
    { id: "proj-other", title: "PO" },
  ]);
});

async function seedScan(projectId: string, deviceId: string, id: string, values: Partial<typeof scans.$inferInsert>) {
  await db.insert(scans).values({ id, projectId, deviceId, ...values });
}

async function peekScan(projectId: string, deviceId: string, id: string) {
  const [row] = await db
    .select()
    .from(scans)
    .where(and(eq(scans.id, id), eq(scans.projectId, projectId), eq(scans.deviceId, deviceId)));
  return row;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/scan", scanRouter);
  app.use(errorHandler);
  return app;
}

function authHeader(userId = "user-1"): string {
  const { token } = createUserToken({ Id: userId, Email: "a@b.com", Role: "User" } as never);
  return `Bearer ${token}`;
}

const validSettings = {
  scan_resolution: 16,
  protocol_mode: "express",
  orientation_mode: "table",
  output_mode: "raw_and_filtered",
  split_mode: "none",
  filter_enabled: true,
  capture_strategy: "fixed_time",
  min_revolutions_per_slice: 2,
  force_recalibration: false,
};

describe("POST /api/scan/:projectId/:deviceId (StartScan)", () => {
  it("creates a pending scan and stamps InitiatedByUserId", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/scan/proj-1/dev-1")
      .set("Authorization", authHeader("user-1"))
      .send(validSettings);

    expect(res.status).toBe(200);
    expect(res.body.Status).toBe("pending");
    expect(res.body.Id).toBeTruthy();

    const stored = await peekScan("proj-1", "dev-1", res.body.Id);
    expect(stored?.status).toBe("pending");
    expect(stored?.initiatedByUserId).toBe("user-1");
    expect(stored?.extra.scan_resolution).toBe(16);
    expect(stored?.createdAt).toBeTruthy();

    const get = await request(app).get(`/api/scan/proj-1/dev-1/${res.body.Id}`).set("Authorization", authHeader());
    expect(get.body).toMatchObject({ Id: res.body.Id, Status: "pending", scan_resolution: 16, StartedAt: null });
  });

  it("rejects invalid scan settings with 400", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/scan/proj-1/dev-1")
      .set("Authorization", authHeader())
      .send({ ...validSettings, scan_resolution: 999 });

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("invalid_scan_settings");
  });

  it("returns 400 when scan settings are missing entirely", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/scan/proj-1/dev-1").set("Authorization", authHeader()).send();
    expect(res.status).toBe(400);
  });

  it("returns 409 scan_in_progress when a scan is already running", async () => {
    await seedScan("proj-1", "dev-2", "scan-running", { status: "running" });

    const app = buildApp();
    const res = await request(app)
      .post("/api/scan/proj-1/dev-2")
      .set("Authorization", authHeader())
      .send(validSettings);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: "scan_in_progress", scanId: "scan-running", status: "running" });
  });

  it("returns the existing scan (200) instead of creating a new one when a scan is already pending", async () => {
    await seedScan("proj-1", "dev-3", "scan-pending", { status: "pending" });

    const app = buildApp();
    const res = await request(app)
      .post("/api/scan/proj-1/dev-3")
      .set("Authorization", authHeader())
      .send(validSettings);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ Id: "scan-pending", Status: "pending" });
    const rows = await db.select().from(scans).where(eq(scans.deviceId, "dev-3"));
    expect(rows.length).toBe(1);
  });

  it("denies starting a scan when the caller lacks Project.Scans.Start on the project", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/scan/proj-other/dev-1")
      .set("Authorization", authHeader())
      .send(validSettings);

    expect(res.status).toBe(403);
  });

  it("rejects requests with no Authorization header", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/scan/proj-1/dev-1").send(validSettings);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/scan/:projectId/:deviceId (GetScans)", () => {
  it("lists scans for the device with ISO timestamps", async () => {
    await seedScan("proj-1", "dev-4", "scan-a", { status: "complete", createdAt: new Date("2026-01-01T00:00:00Z") });
    await seedScan("proj-1", "dev-other", "scan-b", { status: "complete" });

    const app = buildApp();
    const res = await request(app).get("/api/scan/proj-1/dev-4").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ Id: "scan-a", Status: "complete" });
    expect(res.body[0].CreatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("denies listing scans when the caller lacks Project.Scans.Read on the project", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/scan/proj-other/dev-4").set("Authorization", authHeader());
    expect(res.status).toBe(403);
  });
});

describe("GET /api/scan/:projectId/:deviceId/:scanId (GetScan)", () => {
  it("returns a single scan", async () => {
    await seedScan("proj-1", "dev-5", "scan-5", { status: "pending" });

    const app = buildApp();
    const res = await request(app).get("/api/scan/proj-1/dev-5/scan-5").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ Id: "scan-5", Status: "pending" });
  });

  it("returns 404 for a scan that does not exist", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/scan/proj-1/dev-5/does-not-exist").set("Authorization", authHeader());
    expect(res.status).toBe(404);
  });
});

describe("GET /api/scan/:projectId/:deviceId/:scanId/xyz (DownloadScanXyz)", () => {
  it("returns 404 for a scan that does not exist", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/scan/proj-1/dev-5/does-not-exist/xyz").set("Authorization", authHeader());
    expect(res.status).toBe(404);
  });

  it("returns 404 xyz_unavailable for an existing scan (visualizer ingest not yet ported)", async () => {
    await seedScan("proj-1", "dev-5", "scan-6", { status: "complete", objUrl: "https://example.com/scan-6.xyz" });

    const app = buildApp();
    const res = await request(app).get("/api/scan/proj-1/dev-5/scan-6/xyz").set("Authorization", authHeader());

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ reason: "xyz_unavailable" });
  });

  it("is gated by Project.Export, not Project.Scans.Read", async () => {
    await seedScan("proj-1", "dev-5", "scan-7", { status: "complete" });
    hasProjectPermission.mockImplementationOnce(async () => false);

    const app = buildApp();
    const res = await request(app).get("/api/scan/proj-1/dev-5/scan-7/xyz").set("Authorization", authHeader());

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/scan/:projectId/:deviceId/:scanId (DeleteScan)", () => {
  it("deletes an existing scan", async () => {
    await seedScan("proj-1", "dev-6", "scan-8", { status: "complete" });

    const app = buildApp();
    const res = await request(app).delete("/api/scan/proj-1/dev-6/scan-8").set("Authorization", authHeader());

    expect(res.status).toBe(204);
    expect(await peekScan("proj-1", "dev-6", "scan-8")).toBeUndefined();
  });

  it("returns 404 for a scan that does not exist", async () => {
    const app = buildApp();
    const res = await request(app).delete("/api/scan/proj-1/dev-6/does-not-exist").set("Authorization", authHeader());
    expect(res.status).toBe(404);
  });

  it("denies deletion when the caller lacks Project.Scans.Delete on the project", async () => {
    const app = buildApp();
    const res = await request(app).delete("/api/scan/proj-other/dev-6/scan-8").set("Authorization", authHeader());
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/scan/:projectId/:deviceId/:scanId/status (UpdateScanStatus)", () => {
  it("updates status, requiring only authentication (no permission check, matching the old server)", async () => {
    await seedScan("proj-other", "dev-7", "scan-9", { status: "pending" });

    const app = buildApp();
    const res = await request(app)
      .patch("/api/scan/proj-other/dev-7/scan-9/status")
      .set("Authorization", authHeader())
      .send({ Status: "running" });

    expect(res.status).toBe(204);
    const stored = await peekScan("proj-other", "dev-7", "scan-9");
    expect(stored?.status).toBe("running");
    expect(stored?.startedAt).toBeTruthy();
  });

  it("stamps FinishedAt and stores ObjUrl on transition to complete", async () => {
    await seedScan("proj-1", "dev-8", "scan-10", { status: "running", initiatedByUserId: "user-1" });

    const app = buildApp();
    const res = await request(app)
      .patch("/api/scan/proj-1/dev-8/scan-10/status")
      .set("Authorization", authHeader())
      .send({ Status: "complete", ObjUrl: "gs://bucket/scan-10.obj" });

    expect(res.status).toBe(204);
    const stored = await peekScan("proj-1", "dev-8", "scan-10");
    expect(stored?.status).toBe("complete");
    expect(stored?.objUrl).toBe("gs://bucket/scan-10.obj");
    expect(stored?.finishedAt).toBeTruthy();
  });

  it("returns 404 for a scan that does not exist", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/api/scan/proj-1/dev-8/does-not-exist/status")
      .set("Authorization", authHeader())
      .send({ Status: "running" });

    expect(res.status).toBe(404);
  });

  it("rejects requests with no Authorization header", async () => {
    const app = buildApp();
    const res = await request(app).patch("/api/scan/proj-1/dev-8/scan-10/status").send({ Status: "running" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/scan/:projectId/visualizer/latest (LoadLatestCompleteScanIntoVisualizer)", () => {
  it("returns no_devices when the project has no devices", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/scan/proj-1/visualizer/latest").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, reason: "no_devices" });
  });

  it("returns no_complete_scan when devices exist but none has a complete scan", async () => {
    await db.insert(devices).values({ id: "dev-9", projectId: "proj-1", name: "Jetson" });

    const app = buildApp();
    const res = await request(app).post("/api/scan/proj-1/visualizer/latest").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, reason: "no_complete_scan" });
  });

  it("resolves the latest complete scan but reports not_implemented (visualizer ingest not yet ported)", async () => {
    await db.insert(devices).values({ id: "dev-10", projectId: "proj-1", name: "Jetson" });
    await seedScan("proj-1", "dev-10", "scan-11", {
      status: "complete",
      finishedAt: new Date("2026-01-01T00:00:00Z"),
    });
    // Calibration scans are excluded even when newer.
    await seedScan("proj-1", "dev-10", "scan-calib", {
      status: "complete",
      finishedAt: new Date("2026-02-01T00:00:00Z"),
      extra: { IsUploadedCalibrationScan: true },
    });

    const app = buildApp();
    const res = await request(app).post("/api/scan/proj-1/visualizer/latest").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, reason: "not_implemented", deviceId: "dev-10" });
  });
});

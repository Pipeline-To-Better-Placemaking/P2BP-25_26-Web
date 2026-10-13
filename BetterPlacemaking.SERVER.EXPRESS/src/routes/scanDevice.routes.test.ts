import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "../test/db.js";
import { devices, projects, scans } from "../db/schema/index.js";
import type { Db } from "../db/client.js";

// Not wired into app.ts yet (another migration step mounts it), so the test builds a
// minimal app around the router directly - same middleware stack app.ts uses.
const { scanDeviceRouter } = await import("./scanDevice.routes.js");
const { computeApiKeyHash } = await import("../middleware/requireDeviceApiKey.js");
const { errorHandler } = await import("../middleware/errorHandler.js");

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(projects).values({ id: "proj-1", title: "P" });
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/scan-device", scanDeviceRouter);
  app.use(errorHandler);
  return app;
}

// Each device gets its own API key (derived from its id).
function apiKeyFor(id: string): string {
  return `test-api-key-${id}`;
}

async function seedDevice(id: string, projectId: string | null) {
  await db.insert(devices).values({
    id,
    projectId,
    name: "Jetson Unit",
    apiKeyHash: computeApiKeyHash(apiKeyFor(id)),
  });
}

async function seedScan(deviceId: string, id: string, values: Partial<typeof scans.$inferInsert>) {
  await db.insert(scans).values({ id, projectId: "proj-1", deviceId, ...values });
}

async function peekScan(deviceId: string, id: string) {
  const [row] = await db
    .select()
    .from(scans)
    .where(and(eq(scans.id, id), eq(scans.projectId, "proj-1"), eq(scans.deviceId, deviceId)));
  return row;
}

function deviceAuthHeader(id: string): string {
  return `Bearer ${apiKeyFor(id)}`;
}

describe("device API key auth (requireDeviceApiKey)", () => {
  it("rejects requests with no Authorization header", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/scan-device/next-pending");
    expect(res.status).toBe(401);
  });

  it("rejects requests with an unknown device API key", async () => {
    await seedDevice("dev-1", "proj-1");
    const app = buildApp();
    const res = await request(app)
      .get("/api/scan-device/next-pending")
      .set("Authorization", "Bearer not-a-real-key");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/scan-device/next-pending", () => {
  it("returns the oldest pending scan for the device's project", async () => {
    await seedDevice("dev-2", "proj-1");
    await seedScan("dev-2", "scan-newer", { status: "pending", createdAt: new Date("2026-01-02T00:00:00Z") });
    await seedScan("dev-2", "scan-older", { status: "pending", createdAt: new Date("2026-01-01T00:00:00Z") });
    await seedScan("dev-2", "scan-running", { status: "running", createdAt: new Date("2025-12-31T00:00:00Z") });

    const app = buildApp();
    const res = await request(app)
      .get("/api/scan-device/next-pending")
      .set("Authorization", deviceAuthHeader("dev-2"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ProjectId: "proj-1", DeviceId: "dev-2", ScanId: "scan-older" });
  });

  it("returns 404 when the device has no pending scans", async () => {
    await seedDevice("dev-3", "proj-1");

    const app = buildApp();
    const res = await request(app)
      .get("/api/scan-device/next-pending")
      .set("Authorization", deviceAuthHeader("dev-3"));

    expect(res.status).toBe(404);
  });

  it("returns 404 when the device has no ProjectId assigned", async () => {
    await seedDevice("dev-4", null);

    const app = buildApp();
    const res = await request(app)
      .get("/api/scan-device/next-pending")
      .set("Authorization", deviceAuthHeader("dev-4"));

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/scan-device/:scanId/status", () => {
  it("updates the scan's Status and stamps StartedAt when transitioning to running", async () => {
    await seedDevice("dev-5", "proj-1");
    await seedScan("dev-5", "scan-1", { status: "pending" });

    const app = buildApp();
    const res = await request(app)
      .patch("/api/scan-device/scan-1/status")
      .set("Authorization", deviceAuthHeader("dev-5"))
      .send({ Status: "running" });

    expect(res.status).toBe(204);

    const stored = await peekScan("dev-5", "scan-1");
    expect(stored?.status).toBe("running");
    expect(stored?.startedAt).toBeTruthy();
  });

  it("stamps FinishedAt and stores ObjUrl when transitioning to complete", async () => {
    await seedDevice("dev-6", "proj-1");
    await seedScan("dev-6", "scan-2", { status: "running" });

    const app = buildApp();
    const res = await request(app)
      .patch("/api/scan-device/scan-2/status")
      .set("Authorization", deviceAuthHeader("dev-6"))
      .send({ Status: "complete", ObjUrl: "gs://bucket/scan-2.obj" });

    expect(res.status).toBe(204);

    const stored = await peekScan("dev-6", "scan-2");
    expect(stored?.status).toBe("complete");
    expect(stored?.objUrl).toBe("gs://bucket/scan-2.obj");
    expect(stored?.finishedAt).toBeTruthy();
  });

  it("returns 404 for a scan that does not exist", async () => {
    await seedDevice("dev-7", "proj-1");

    const app = buildApp();
    const res = await request(app)
      .patch("/api/scan-device/does-not-exist/status")
      .set("Authorization", deviceAuthHeader("dev-7"))
      .send({ Status: "running" });

    expect(res.status).toBe(404);
  });

  it("rejects requests without a valid device API key", async () => {
    await seedDevice("dev-8", "proj-1");
    await seedScan("dev-8", "scan-3", { status: "pending" });

    const app = buildApp();
    const res = await request(app)
      .patch("/api/scan-device/scan-3/status")
      .set("Authorization", "Bearer wrong-key")
      .send({ Status: "running" });

    expect(res.status).toBe(401);
  });
});

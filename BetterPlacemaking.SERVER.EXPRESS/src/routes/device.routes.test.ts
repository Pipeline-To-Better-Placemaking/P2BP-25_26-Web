import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db.js";
import { devices, projects } from "../db/schema/index.js";
import type { Db } from "../db/client.js";

vi.mock("../authorization/authorizationService.js", () => ({
  hasGlobalPermission: async () => true,
  hasProjectPermission: async () => true,
  getEffectiveGlobalPermissions: async () => [],
  getEffectiveProjectPermissions: async () => [],
  getProjectRoleOptions: async () => [],
}));

const { createApp } = await import("../app.js");
const { createUserToken } = await import("../services/tokenService.js");

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(projects).values({ id: "proj-1", title: "P" });
});

function authHeader(): string {
  const { token } = createUserToken({ Id: "user-1", Email: "a@b.com", Role: "User" } as never);
  return `Bearer ${token}`;
}

async function peekDevice(id: string) {
  const [row] = await db.select().from(devices).where(eq(devices.id, id));
  return row;
}

describe("POST /api/device/project/:projectId (clobber fix)", () => {
  it("ignores a client-supplied Id and creates a new document instead of overwriting an existing one", async () => {
    await db.insert(devices).values({
      id: "existing-device",
      projectId: "proj-1",
      name: "Original Device",
      apiKeyHash: "untouchable-secret-hash",
    });

    const app = createApp();
    const res = await request(app)
      .post("/api/device/project/proj-1")
      .set("Authorization", authHeader())
      .send({ Id: "existing-device", Name: "Attempted overwrite" });

    expect(res.status).toBe(201);
    expect(res.body.Id).not.toBe("existing-device");
    expect(res.body.Name).toBe("Attempted overwrite");

    const original = await peekDevice("existing-device");
    expect(original?.name).toBe("Original Device");
    expect(original?.apiKeyHash).toBe("untouchable-secret-hash");
  });
});

describe("PUT /api/device/project/:projectId/:id", () => {
  it("preserves ApiKeyHash and HealthReport regardless of the request body", async () => {
    await db.insert(devices).values({
      id: "dev-1",
      projectId: "proj-1",
      name: "Old Name",
      apiKeyHash: "keep-me",
      healthReport: { Timestamp: 123 },
    });

    const app = createApp();
    const res = await request(app)
      .put("/api/device/project/proj-1/dev-1")
      .set("Authorization", authHeader())
      .send({ Id: "dev-1", Name: "New Name", ApiKeyHash: "attacker-supplied", HealthReport: null });

    expect(res.status).toBe(200);
    expect(res.body.Name).toBe("New Name");

    const stored = await peekDevice("dev-1");
    expect(stored?.apiKeyHash).toBe("keep-me");
    expect(stored?.healthReport).toEqual({ Timestamp: 123 });
  });
});

describe("POST /api/device/project/:projectId/:id/apikey", () => {
  it("stores only a hash of the generated key and never exposes it via the device DTO", async () => {
    await db.insert(devices).values({ id: "dev-2", projectId: "proj-1", name: "Unit" });

    const app = createApp();
    const res = await request(app)
      .post("/api/device/project/proj-1/dev-2/apikey")
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body.ApiKey).toBeTruthy();
    const stored = await peekDevice("dev-2");
    expect(stored?.apiKeyHash).toBeTruthy();
    expect(stored?.apiKeyHash).not.toBe(res.body.ApiKey);

    const get = await request(app).get("/api/device/project/proj-1/dev-2").set("Authorization", authHeader());
    expect(get.status).toBe(200);
    expect(get.body.ApiKeyHash).toBeUndefined();
  });
});

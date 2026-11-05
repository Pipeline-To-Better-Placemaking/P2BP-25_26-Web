import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const hasProjectPermission = vi.fn(async (..._args: unknown[]) => true);
vi.mock("../authorization/authorizationService.js", () => ({
  hasGlobalPermission: async () => true,
  hasProjectPermission: (...args: unknown[]) => hasProjectPermission(...args),
  getEffectiveGlobalPermissions: async () => [],
  getEffectiveProjectPermissions: async () => [],
  getProjectRoleOptions: async () => [],
}));

const { createApp } = await import("../app.js");
const { env } = await import("../config/env.js");
const { createUserToken } = await import("../services/tokenService.js");
const { createTestDb } = await import("../test/db.js");
const { createFakeStorage } = await import("../test/fakeStorage.js");
const { floorplanLibrary, projects } = await import("../db/schema/index.js");
const { pxPerMetre, CALIBRATION_SPEC_MINUTES } = await import("../services/calibrationSpecService.js");

const SECRET = "ticket-secret-ticket-secret-ticket-secret";
const original = { s: env.workstationTicketSecret, u: env.workstationBaseUrl };
let storage: ReturnType<typeof createFakeStorage>;

function authHeader(): string {
  const { token } = createUserToken({ Id: "user-1", Email: "a@b.com", Role: "User" } as never);
  return `Bearer ${token}`;
}

function decode(spec: string) {
  // Verified the way the workstation (PyJWT) does: HS256, shared secret, audience.
  return jwt.verify(spec, SECRET, { audience: "p2bp-workstation", algorithms: ["HS256"] }) as jwt.JwtPayload;
}

const post = (projectId: string, body?: object) =>
  request(createApp())
    .post(`/api/workstation/project/${projectId}/calibration-spec`)
    .set("Authorization", authHeader())
    .send(body ?? {});

beforeAll(async () => {
  const db = await createTestDb();
  await db.insert(projects).values([
    { id: "proj-1", title: "Living Room" },
    { id: "proj-2", title: "  " },
    { id: "proj-3", title: "Other" },
  ]);
  const base = { userId: "user-1", imageSizeBytes: 10, imageContentType: "image/png" };
  await db.insert(floorplanLibrary).values([
    {
      ...base, id: "fp-old", projectId: "proj-1", nickname: "Old", imagePath: "fp/old.png",
      imageWidth: 100, imageHeight: 50, updatedAtUtc: new Date("2026-10-01T00:00:00Z"),
      calibration: { ReferenceDistanceMm: 1000, MmPerPixel: 20, CalibratedAtUtc: "2026-10-01T00:00:00Z" },
    },
    {
      ...base, id: "fp-new", projectId: "proj-1", nickname: "Ground floor", imagePath: "fp/new.png",
      imageWidth: 741, imageHeight: 502, updatedAtUtc: new Date("2026-10-20T00:00:00Z"),
      calibration: { ReferenceDistanceMm: 7410, MmPerPixel: 10, CalibratedAtUtc: "2026-10-20T00:00:00Z" },
    },
    {
      ...base, id: "fp-other", projectId: "proj-3", nickname: "Elsewhere", imagePath: "fp/other.png",
      imageWidth: 10, imageHeight: 10,
    },
  ]);
});

beforeEach(() => {
  hasProjectPermission.mockClear();
  hasProjectPermission.mockResolvedValue(true);
  env.workstationTicketSecret = SECRET;
  env.workstationBaseUrl = "https://p2bp-workstation.tail1.ts.net";
  storage = createFakeStorage();
});

afterEach(() => {
  env.workstationTicketSecret = original.s;
  env.workstationBaseUrl = original.u;
});

describe("POST /api/workstation/project/:projectId/calibration-spec", () => {
  it("signs the project title and its newest floor plan, with the scale converted to px/m", async () => {
    const res = await post("proj-1");

    expect(res.status).toBe(200);
    expect(res.body.Summary).toEqual({
      ProjectTitle: "Living Room",
      FloorplanId: "fp-new",
      FloorplanNickname: "Ground floor",
      LayoutPxPerM: 100,
    });
    const claims = decode(res.body.Spec);
    expect(claims).toMatchObject({ sub: "user-1", pid: "proj-1", scope: "amc-calibration-spec" });
    expect(claims.exp! - claims.iat!).toBe(CALIBRATION_SPEC_MINUTES * 60);
    expect(claims.spec.floorplan).toMatchObject({ id: "fp-new", width: 741, height: 502, pxPerM: 100, contentType: "image/png" });
    expect(claims.spec.floorplan.url).toContain("fp/new.png");
  });

  it("signs a short-lived download link, not the 7-day default", async () => {
    await post("proj-1");
    expect(storage.bucket.createSignedUrl).toHaveBeenCalledWith("fp/new.png", CALIBRATION_SPEC_MINUTES * 60, expect.anything());
  });

  it("uses the floor plan the caller picks, if it belongs to the project", async () => {
    const res = await post("proj-1", { FloorplanId: "fp-old" });
    expect(res.status).toBe(200);
    expect(res.body.Summary.LayoutPxPerM).toBe(50);
  });

  it("refuses (404) a floor plan from another project", async () => {
    const res = await post("proj-1", { FloorplanId: "fp-other" });
    expect(res.status).toBe(404);
    expect(res.body.Spec).toBeUndefined();
  });

  it("works without a floor plan, falling back to the id when the title is blank", async () => {
    const res = await post("proj-2");
    expect(res.status).toBe(200);
    expect(res.body.Summary).toMatchObject({ ProjectTitle: "proj-2", FloorplanId: null, LayoutPxPerM: null });
    expect(decode(res.body.Spec).spec.floorplan).toBeNull();
  });

  it("is a 404 for a project that does not exist", async () => {
    expect((await post("nope")).status).toBe(404);
  });

  it("rejects a malformed FloorplanId", async () => {
    expect((await post("proj-1", { FloorplanId: 7 })).status).toBe(400);
  });

  it("checks Project.Vision.Read and refuses without it", async () => {
    hasProjectPermission.mockResolvedValue(false);
    const res = await post("proj-1");
    expect(hasProjectPermission).toHaveBeenCalledWith("user-1", "User", "proj-1", "Project.Vision.Read");
    expect(res.status).toBe(403);
    expect(res.body.Spec).toBeUndefined();
  });

  it("is a 503 when workstation control is not configured", async () => {
    env.workstationTicketSecret = undefined;
    expect((await post("proj-1")).status).toBe(503);
  });

  it("cannot be used as a control ticket: its scope is different", async () => {
    const res = await post("proj-1");
    expect(decode(res.body.Spec).scope).not.toBe("amc");
  });
});

describe("pxPerMetre", () => {
  it("converts mm per pixel to AMC's layout px per metre", () => {
    expect(pxPerMetre(10)).toBe(100);
    expect(pxPerMetre(3)).toBe(333.3333);
  });
  it("is null for a missing or invalid scale", () => {
    for (const v of [undefined, null, 0, -1, Number.NaN, "10"]) expect(pxPerMetre(v)).toBeNull();
  });
});

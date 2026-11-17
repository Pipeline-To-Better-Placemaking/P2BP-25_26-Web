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
const { CALIBRATION_SPEC_MINUTES } = await import("../services/calibrationSpecService.js");

const SECRET = "ticket-secret-ticket-secret-ticket-secret";
const original = { s: env.workstationTicketSecret, u: env.workstationAmcUrl, amcMinutes: env.workstationAmcTicketMinutes };
let storage: ReturnType<typeof createFakeStorage>;

function authHeader(): string {
  const { token } = createUserToken({ Id: "user-1", Email: "a@b.com", Role: "User" } as never);
  return `Bearer ${token}`;
}

function decode(token: string) {
  // Verified the way the workstation (PyJWT) does: HS256, shared secret, audience.
  return jwt.verify(token, SECRET, { audience: "p2bp-workstation", algorithms: ["HS256"] }) as jwt.JwtPayload;
}

const provision = (projectId: string, body?: object) =>
  request(createApp())
    .post(`/api/workstation/project/${projectId}/provision`)
    .set("Authorization", authHeader())
    .send(body ?? {});

beforeAll(async () => {
  const db = await createTestDb();
  await db.insert(projects).values([
    { id: "proj-1", title: "Lobby", workstationFolder: "lobby-east" },
    { id: "proj-2", title: "No folder" },
    { id: "proj-3", title: "Other", workstationFolder: "other" },
  ]);
  const base = { userId: "user-1", imageSizeBytes: 10, imageContentType: "image/png" };
  await db.insert(floorplanLibrary).values([
    {
      ...base, id: "fp-1", projectId: "proj-1", nickname: "Ground floor", imagePath: "fp/lobby.png",
      imageWidth: 741, imageHeight: 502,
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
  env.workstationAmcUrl = "https://p2bp-workstation.tail1.ts.net/";
  env.workstationAmcTicketMinutes = 25;
  storage = createFakeStorage();
});

afterEach(() => {
  env.workstationTicketSecret = original.s;
  env.workstationAmcUrl = original.u;
  env.workstationAmcTicketMinutes = original.amcMinutes;
});

describe("POST /api/workstation/project/:projectId/provision", () => {
  it("issues a 15 minute amc-provision ticket and a spec carrying the folder", async () => {
    const res = await provision("proj-1");

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["ExpiresAt", "Spec", "Ticket", "WorkstationUrl"]);
    expect(res.body.WorkstationUrl).toBe("https://p2bp-workstation.tail1.ts.net"); // trailing slash trimmed

    const ticket = decode(res.body.Ticket);
    expect(ticket).toMatchObject({ sub: "user-1", pid: "proj-1", scope: "amc-provision", aud: "p2bp-workstation" });
    expect(ticket.iss).toBe(env.jwtIssuer);
    expect(ticket.exp! - ticket.iat!).toBe(15 * 60);

    const spec = decode(res.body.Spec);
    expect(spec).toMatchObject({ sub: "user-1", pid: "proj-1", scope: "amc-calibration-spec" });
    expect(spec.exp! - spec.iat!).toBe(CALIBRATION_SPEC_MINUTES * 60);
    expect(spec.spec.folder).toBe("lobby-east");
    expect(spec.spec.floorplan).toMatchObject({ id: "fp-1", pxPerM: 100 });

    const expiresAt = new Date(res.body.ExpiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt).toBeLessThanOrEqual(Math.min(ticket.exp!, spec.exp!) * 1000 + 1000);
  });

  it("signs the floor plan link for 15 minutes", async () => {
    await provision("proj-1");
    expect(storage.bucket.createSignedUrl).toHaveBeenCalledWith("fp/lobby.png", CALIBRATION_SPEC_MINUTES * 60, expect.anything());
  });

  it("does not follow WORKSTATION_AMC_TICKET_MINUTES", async () => {
    env.workstationAmcTicketMinutes = 40;
    const res = await provision("proj-1");
    const ticket = decode(res.body.Ticket);
    expect(ticket.exp! - ticket.iat!).toBe(15 * 60);
  });

  it("differs in scope from the AMC control ticket", async () => {
    const app = createApp();
    const amc = await request(app).post("/api/workstation/project/proj-1/ticket").set("Authorization", authHeader());
    const prov = await provision("proj-1");
    expect(decode(amc.body.Ticket).scope).toBe("amc");
    expect(decode(prov.body.Ticket).scope).toBe("amc-provision");
  });

  it("is a 400 when the project has no workstation folder", async () => {
    const res = await provision("proj-2");
    expect(res.status).toBe(400);
    expect(res.body.Message).toMatch(/workstation folder/i);
    expect(res.body.Ticket).toBeUndefined();
    expect(res.body.Spec).toBeUndefined();
  });

  it("is a 404 for an unknown project or a floor plan from another project", async () => {
    expect((await provision("nope")).status).toBe(404);
    expect((await provision("proj-1", { FloorplanId: "fp-other" })).status).toBe(404);
  });

  it("rejects a malformed FloorplanId", async () => {
    expect((await provision("proj-1", { FloorplanId: 7 })).status).toBe(400);
  });

  it("is a 503 until the secret and the workstation URL are both set", async () => {
    env.workstationTicketSecret = undefined;
    expect((await provision("proj-1")).status).toBe(503);

    env.workstationTicketSecret = SECRET;
    env.workstationAmcUrl = undefined;
    expect((await provision("proj-1")).status).toBe(503);
  });

  it("checks Project.Update on the requested project", async () => {
    await provision("proj-1");
    expect(hasProjectPermission).toHaveBeenCalledWith("user-1", "User", "proj-1", "Project.Update");
  });

  it("refuses (403) a user with only Project.Vision.Read", async () => {
    hasProjectPermission.mockImplementation(async (...args: unknown[]) => args[3] === "Project.Vision.Read");
    const res = await provision("proj-1");
    expect(res.status).toBe(403);
    expect(res.body.Ticket).toBeUndefined();
  });

  it("requires a login (401)", async () => {
    const res = await request(createApp()).post("/api/workstation/project/proj-1/provision");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/workstation/project/:projectId/delete-ticket", () => {
  const deleteTicket = (projectId: string) =>
    request(createApp())
      .post(`/api/workstation/project/${projectId}/delete-ticket`)
      .set("Authorization", authHeader());

  it("issues a 5 minute amc-delete ticket and the workstation URL", async () => {
    const res = await deleteTicket("proj-1");

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["ExpiresAt", "Ticket", "WorkstationUrl"]);
    expect(res.body.WorkstationUrl).toBe("https://p2bp-workstation.tail1.ts.net");

    const ticket = decode(res.body.Ticket);
    expect(ticket).toMatchObject({ sub: "user-1", pid: "proj-1", scope: "amc-delete", aud: "p2bp-workstation" });
    expect(ticket.iss).toBe(env.jwtIssuer);
    expect(ticket.exp! - ticket.iat!).toBe(5 * 60);

    const expiresAt = new Date(res.body.ExpiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt).toBeLessThanOrEqual(ticket.exp! * 1000 + 1000);
  });

  it("does not follow WORKSTATION_AMC_TICKET_MINUTES", async () => {
    env.workstationAmcTicketMinutes = 40;
    const ticket = decode((await deleteTicket("proj-1")).body.Ticket);
    expect(ticket.exp! - ticket.iat!).toBe(5 * 60);
  });

  it("issues a ticket for a project without a workstation folder", async () => {
    // The workstation answers 404 for it, which the web app treats as deleted.
    const res = await deleteTicket("proj-2");
    expect(res.status).toBe(200);
    expect(decode(res.body.Ticket).pid).toBe("proj-2");
  });

  it("differs in scope from the control and provision tickets", async () => {
    const app = createApp();
    const amc = await request(app).post("/api/workstation/project/proj-1/ticket").set("Authorization", authHeader());
    const del = await deleteTicket("proj-1");
    expect(decode(amc.body.Ticket).scope).toBe("amc");
    expect(decode(del.body.Ticket).scope).toBe("amc-delete");
  });

  it("is a 404 for an unknown project", async () => {
    const res = await deleteTicket("nope");
    expect(res.status).toBe(404);
    expect(res.body.Ticket).toBeUndefined();
  });

  it("is a 503 until the secret and the workstation URL are both set", async () => {
    env.workstationTicketSecret = undefined;
    const noSecret = await deleteTicket("proj-1");
    expect(noSecret.status).toBe(503);
    expect(noSecret.body).toEqual({ Message: "Workstation control is not configured." });

    env.workstationTicketSecret = SECRET;
    env.workstationAmcUrl = undefined;
    expect((await deleteTicket("proj-1")).status).toBe(503);
  });

  it("checks Project.Delete on the requested project", async () => {
    await deleteTicket("proj-1");
    expect(hasProjectPermission).toHaveBeenCalledWith("user-1", "User", "proj-1", "Project.Delete");
  });

  it("refuses (403) a user with only Project.Update", async () => {
    hasProjectPermission.mockImplementation(async (...args: unknown[]) => args[3] === "Project.Update");
    const res = await deleteTicket("proj-1");
    expect(res.status).toBe(403);
    expect(res.body.Ticket).toBeUndefined();
  });

  it("requires a login (401)", async () => {
    const res = await request(createApp()).post("/api/workstation/project/proj-1/delete-ticket");
    expect(res.status).toBe(401);
  });
});

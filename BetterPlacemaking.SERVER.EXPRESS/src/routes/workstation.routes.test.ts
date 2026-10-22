import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const SECRET = "ticket-secret-ticket-secret-ticket-secret";
const original = { s: env.workstationTicketSecret, u: env.workstationBaseUrl };

function authHeader(): string {
  const { token } = createUserToken({ Id: "user-1", Email: "a@b.com", Role: "User" } as never);
  return `Bearer ${token}`;
}

beforeEach(() => {
  hasProjectPermission.mockClear();
  hasProjectPermission.mockResolvedValue(true);
  env.workstationTicketSecret = SECRET;
  env.workstationBaseUrl = "https://p2bp-workstation.tail1.ts.net/";
});

afterEach(() => {
  env.workstationTicketSecret = original.s;
  env.workstationBaseUrl = original.u;
});

describe("POST /api/workstation/project/:projectId/ticket", () => {
  it("issues an AMC-scoped ticket for the user and project, and returns the workstation URL", async () => {
    const res = await request(createApp()).post("/api/workstation/project/proj-1/ticket").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body.WorkstationUrl).toBe("https://p2bp-workstation.tail1.ts.net"); // trailing slash trimmed
    expect(new Date(res.body.ExpiresAt).getTime()).toBeGreaterThan(Date.now());

    // Verified the way the workstation (PyJWT) does: HS256, shared secret, audience, scope.
    const claims = jwt.verify(res.body.Ticket, SECRET, { audience: "p2bp-workstation", algorithms: ["HS256"] }) as jwt.JwtPayload;
    expect(claims.sub).toBe("user-1");
    expect(claims.pid).toBe("proj-1");
    expect(claims.scope).toBe("amc");
    expect(claims.exp! - claims.iat!).toBe(25 * 60);
  });

  it("checks Project.Vision.Read on the requested project", async () => {
    await request(createApp()).post("/api/workstation/project/proj-9/ticket").set("Authorization", authHeader());
    expect(hasProjectPermission).toHaveBeenCalledWith("user-1", "User", "proj-9", "Project.Vision.Read");
  });

  it("refuses (403) and issues nothing when the user lacks the permission", async () => {
    hasProjectPermission.mockResolvedValue(false);
    const res = await request(createApp()).post("/api/workstation/project/proj-1/ticket").set("Authorization", authHeader());
    expect(res.status).toBe(403);
    expect(res.body.Ticket).toBeUndefined();
  });

  it("requires a login (401)", async () => {
    const res = await request(createApp()).post("/api/workstation/project/proj-1/ticket");
    expect(res.status).toBe(401);
  });

  it("is a 503 when the secret or the workstation URL is not configured", async () => {
    env.workstationTicketSecret = undefined;
    let res = await request(createApp()).post("/api/workstation/project/proj-1/ticket").set("Authorization", authHeader());
    expect(res.status).toBe(503);

    env.workstationTicketSecret = SECRET;
    env.workstationBaseUrl = undefined;
    res = await request(createApp()).post("/api/workstation/project/proj-1/ticket").set("Authorization", authHeader());
    expect(res.status).toBe(503);
  });

  it("a ticket is not a login token: the API rejects it as a bearer credential", async () => {
    const res = await request(createApp()).post("/api/workstation/project/proj-1/ticket").set("Authorization", authHeader());
    const probe = await request(createApp()).get("/api/device").set("Authorization", `Bearer ${res.body.Ticket}`);
    expect(probe.status).toBe(401);
  });
});

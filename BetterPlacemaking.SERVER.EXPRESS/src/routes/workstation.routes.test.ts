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
const { createTrackingTicket, TRACKING_TICKET_SCOPE } = await import("../services/trackingTicketService.js");

const SECRET = "ticket-secret-ticket-secret-ticket-secret";
const original = {
  s: env.workstationTicketSecret,
  u: env.workstationAmcUrl,
  amcMinutes: env.workstationAmcTicketMinutes,
  trackingMinutes: env.workstationTicketMinutes,
};

function authHeader(): string {
  const { token } = createUserToken({ Id: "user-1", Email: "a@b.com", Role: "User" } as never);
  return `Bearer ${token}`;
}

beforeEach(() => {
  hasProjectPermission.mockClear();
  hasProjectPermission.mockResolvedValue(true);
  env.workstationTicketSecret = SECRET;
  env.workstationAmcUrl = "https://p2bp-workstation.tail1.ts.net/";
  env.workstationAmcTicketMinutes = 25;
  env.workstationTicketMinutes = 5;
});

afterEach(() => {
  env.workstationTicketSecret = original.s;
  env.workstationAmcUrl = original.u;
  env.workstationAmcTicketMinutes = original.amcMinutes;
  env.workstationTicketMinutes = original.trackingMinutes;
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
    env.workstationAmcUrl = undefined;
    res = await request(createApp()).post("/api/workstation/project/proj-1/ticket").set("Authorization", authHeader());
    expect(res.status).toBe(503);
  });

  it("a ticket is not a login token: the API rejects it as a bearer credential", async () => {
    const res = await request(createApp()).post("/api/workstation/project/proj-1/ticket").set("Authorization", authHeader());
    const probe = await request(createApp()).get("/api/device").set("Authorization", `Bearer ${res.body.Ticket}`);
    expect(probe.status).toBe(401);
  });

  it("cannot be confused with a tracking ticket: same secret and audience, different scope", async () => {
    const res = await request(createApp()).post("/api/workstation/project/proj-1/ticket").set("Authorization", authHeader());
    const amc = jwt.verify(res.body.Ticket, SECRET, { audience: "p2bp-workstation", algorithms: ["HS256"] }) as jwt.JwtPayload;

    const { ticket } = createTrackingTicket({ sub: "user-1", email: "a@b.com" } as never, "proj-1");
    const tracking = jwt.verify(ticket, SECRET, { audience: "p2bp-workstation", algorithms: ["HS256"] }) as jwt.JwtPayload;

    expect(amc.scope).toBe("amc");
    expect(tracking.scope).toBe(TRACKING_TICKET_SCOPE);
    expect(amc.scope).not.toBe(tracking.scope);
  });

  it("is a 503 when only the tracking URL is configured", async () => {
    env.workstationAmcUrl = undefined;
    const saved = env.workstationTrackingUrl;
    env.workstationTrackingUrl = "https://p2bp-workstation.tail1.ts.net:8443";
    try {
      const res = await request(createApp()).post("/api/workstation/project/proj-1/ticket").set("Authorization", authHeader());
      expect(res.status).toBe(503);
    } finally {
      env.workstationTrackingUrl = saved;
    }
  });

  it("takes its lifetime from WORKSTATION_AMC_TICKET_MINUTES, not the tracking minutes", async () => {
    env.workstationAmcTicketMinutes = 40;
    env.workstationTicketMinutes = 3;
    const res = await request(createApp()).post("/api/workstation/project/proj-1/ticket").set("Authorization", authHeader());
    const claims = jwt.decode(res.body.Ticket) as jwt.JwtPayload;
    expect(claims.exp! - claims.iat!).toBe(40 * 60);

    const { ticket } = createTrackingTicket({ sub: "user-1" } as never, "proj-1");
    const tracking = jwt.decode(ticket) as jwt.JwtPayload;
    expect(tracking.exp! - tracking.iat!).toBe(3 * 60);
  });
});

describe("WORKSTATION_AMC_TICKET_MINUTES", () => {
  async function loadEnv(vars: Record<string, string | undefined>) {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      vi.resetModules();
      return (await import("../config/env.js")).env;
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  it("defaults to 25 and does not follow WORKSTATION_TICKET_MINUTES", async () => {
    const fresh = await loadEnv({ WORKSTATION_AMC_TICKET_MINUTES: undefined, WORKSTATION_TICKET_MINUTES: "7" });
    expect(fresh.workstationAmcTicketMinutes).toBe(25);
    expect(fresh.workstationTicketMinutes).toBe(7);
  });

  it("does not change the tracking default of 5 when set", async () => {
    const fresh = await loadEnv({ WORKSTATION_AMC_TICKET_MINUTES: "40", WORKSTATION_TICKET_MINUTES: undefined });
    expect(fresh.workstationAmcTicketMinutes).toBe(40);
    expect(fresh.workstationTicketMinutes).toBe(5);
  });
});

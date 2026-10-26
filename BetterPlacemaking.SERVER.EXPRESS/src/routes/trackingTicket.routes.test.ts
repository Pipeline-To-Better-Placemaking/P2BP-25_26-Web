import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const hasGlobalPermission = vi.fn(async () => false);
const hasProjectPermission = vi.fn(
  async (userId: string, _role: string | undefined, projectId: string) =>
    projectId === "proj-1" && userId !== "no-access",
);

vi.mock("../authorization/authorizationService.js", () => ({
  hasGlobalPermission: (...args: unknown[]) => hasGlobalPermission(...(args as [string, string | undefined, string])),
  hasProjectPermission: (...args: unknown[]) =>
    hasProjectPermission(...(args as [string, string | undefined, string, string])),
  getEffectiveGlobalPermissions: async () => [],
  getEffectiveProjectPermissions: async () => [],
  getProjectRoleOptions: async () => [],
}));

const { trackingTicketRouter, resetTrackingTicketRateLimit } = await import("./trackingTicket.routes.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { createUserToken } = await import("../services/tokenService.js");
const { env, optionalPositiveInt } = await import("../config/env.js");

const SECRET = "test-workstation-ticket-secret";
const original = {
  secret: env.workstationTicketSecret,
  url: env.workstationTrackingUrl,
  minutes: env.workstationTicketMinutes,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/workstation-tracking", trackingTicketRouter);
  app.use(errorHandler);
  return app;
}

function authHeader(userId = "user-1", extra: { FirstName?: string; LastName?: string; Email?: string | null } = {}) {
  const { token } = createUserToken({ Id: userId, Email: "a@b.com", Role: "User", ...extra } as never);
  return `Bearer ${token}`;
}

function post(projectId = "proj-1", auth: string | null = authHeader()) {
  const req = request(buildApp()).post(`/api/workstation-tracking/project/${projectId}/ticket`);
  return auth ? req.set("Authorization", auth) : req;
}

let clock = 1_700_000_000_000;

beforeEach(() => {
  env.workstationTicketSecret = SECRET;
  env.workstationTrackingUrl = "https://workstation.example.ts.net:8443//";
  env.workstationTicketMinutes = 5;
  clock = 1_700_000_000_000;
  resetTrackingTicketRateLimit(() => clock);
});

afterEach(() => {
  env.workstationTicketSecret = original.secret;
  env.workstationTrackingUrl = original.url;
  env.workstationTicketMinutes = original.minutes;
  resetTrackingTicketRateLimit();
});

describe("POST /api/workstation-tracking/project/:projectId/ticket", () => {
  it("rejects requests with no bearer token", async () => {
    const res = await post("proj-1", null);
    expect(res.status).toBe(401);
  });

  it("returns 403 without Project.Scans.Read on the project", async () => {
    const res = await post("proj-other");
    expect(res.status).toBe(403);
    expect(hasProjectPermission).toHaveBeenCalledWith("user-1", "User", "proj-other", "Project.Scans.Read");
  });

  it("returns 503 when the secret is not configured", async () => {
    env.workstationTicketSecret = undefined;
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.body.Message).toBeTruthy();
  });

  it("returns 503 when the tracking URL is not configured", async () => {
    env.workstationTrackingUrl = undefined;
    const res = await post();
    expect(res.status).toBe(503);
  });

  it("issues a signed ticket with the expected claims", async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await post("proj-1", authHeader("user-1", { FirstName: "Ada", LastName: "Lovelace" }));

    expect(res.status).toBe(200);
    expect(res.body.WorkstationUrl).toBe("https://workstation.example.ts.net:8443");
    expect(typeof res.body.Ticket).toBe("string");
    expect(new Date(res.body.ExpiresAt).toISOString()).toBe(res.body.ExpiresAt);

    const decoded = jwt.verify(res.body.Ticket, SECRET, {
      algorithms: ["HS256"],
      audience: "p2bp-workstation",
      issuer: env.jwtIssuer,
    }) as jwt.JwtPayload;

    expect(decoded.sub).toBe("user-1");
    expect(decoded.pid).toBe("proj-1");
    expect(decoded.scope).toBe("tracking");
    expect(decoded.name).toBe("Ada Lovelace");
    expect(decoded.aud).toBe("p2bp-workstation");
    expect(decoded.iss).toBe(env.jwtIssuer);
    expect(decoded.exp! - decoded.iat!).toBe(300);
    expect(decoded.exp!).toBeGreaterThanOrEqual(before + 300);
    expect(decoded.exp!).toBeLessThanOrEqual(before + 302);
    expect(Math.abs(Date.parse(res.body.ExpiresAt) / 1000 - decoded.exp!)).toBeLessThanOrEqual(2);
  });

  it("falls back to the email for the name claim", async () => {
    const res = await post("proj-1", authHeader("user-1", { Email: "ada@example.com" }));
    expect(res.status).toBe(200);
    expect((jwt.decode(res.body.Ticket) as jwt.JwtPayload).name).toBe("ada@example.com");
  });

  it("falls back to the user id when there is no name or email", async () => {
    const res = await post("proj-1", authHeader("user-1", { Email: null }));
    expect(res.status).toBe(200);
    expect((jwt.decode(res.body.Ticket) as jwt.JwtPayload).name).toBe("user-1");
  });

  it("returns 429 with Retry-After on a second request within 60 s", async () => {
    expect((await post()).status).toBe(200);

    clock += 20_000;
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("40");
    expect(res.body.RetryAfterSeconds).toBe(40);
    expect(res.body.Message).toBeTruthy();
  });

  it("allows a new ticket once the window has passed", async () => {
    expect((await post()).status).toBe(200);
    clock += 60_000;
    expect((await post()).status).toBe(200);
  });

  it("does not block a different user", async () => {
    expect((await post("proj-1", authHeader("user-1"))).status).toBe(200);
    expect((await post("proj-1", authHeader("user-2"))).status).toBe(200);
  });

  it("allows a ticket on another project 5 s after a 403", async () => {
    expect((await post("proj-other")).status).toBe(403);
    clock += 5_000;
    expect((await post("proj-1")).status).toBe(200);
  });

  it("returns 429 on an immediate retry after a 403", async () => {
    expect((await post("proj-other")).status).toBe(403);
    clock += 2_000;
    const res = await post("proj-1");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("3");
  });

  it("uses the short window after a 503", async () => {
    env.workstationTicketSecret = undefined;
    expect((await post()).status).toBe(503);
    env.workstationTicketSecret = SECRET;
    clock += 1_000;
    expect((await post()).status).toBe(429);
    clock += 4_000;
    expect((await post()).status).toBe(200);
  });
});

describe("optionalPositiveInt (WORKSTATION_TICKET_MINUTES parser)", () => {
  const NAME = "TEST_POSITIVE_INT_ONLY";
  afterEach(() => {
    delete process.env[NAME];
  });

  it.each([
    [undefined, 5],
    ["", 5],
    ["10", 10],
    [" 7 ", 7],
    ["0", 5],
    ["-3", 5],
    ["2.5", 5],
    ["abc", 5],
    ["3m", 5],
  ])("parses %j as %i", (raw, expected) => {
    if (raw === undefined) delete process.env[NAME];
    else process.env[NAME] = raw;
    expect(optionalPositiveInt(NAME, 5)).toBe(expected);
  });
});

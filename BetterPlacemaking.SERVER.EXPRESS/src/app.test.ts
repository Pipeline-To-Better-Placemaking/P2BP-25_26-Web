import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

const app = createApp();

describe("app wiring (no database access required)", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("rejects unauthenticated requests to protected user routes", async () => {
    const res = await request(app).get("/api/user");
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated requests to admin routes", async () => {
    const res = await request(app).put("/api/admin/update-role").send({ TargetEmail: "a@b.com", NewRole: "User" });
    expect(res.status).toBe(401);
  });

  it("rejects login with a missing password before touching database", async () => {
    const res = await request(app).post("/api/login/authenticate").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
    expect(res.body.Success).toBe(false);
  });

  it("rejects registration with a missing email before touching database", async () => {
    const res = await request(app).post("/api/register").send({ Password: "hunter22" });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed bearer token", async () => {
    const res = await request(app).get("/api/user").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("returns 401 from /api/auth/refresh when the refresh cookie is missing", async () => {
    const res = await request(app).post("/api/auth/refresh");
    expect(res.status).toBe(401);
    expect(res.body.Message).toMatch(/refresh token/i);
  });

  it("logout succeeds even with no refresh cookie present", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(200);
    expect(res.body.Success).toBe(true);
  });

  it("rejects unauthenticated requests to project routes", async () => {
    const res = await request(app).get("/api/project");
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated requests to device routes", async () => {
    const res = await request(app).get("/api/device/project/some-project");
    expect(res.status).toBe(401);
  });

  // These three routers each existed in src/routes/ for a while WITHOUT being mounted in
  // app.ts, so every one of their own route tests passed while the real server 404'd the
  // endpoints. Asserting "not 404" through createApp() is what catches that class of bug;
  // the specific auth codes are covered in each router's own test file.
  it("mounts the scan router at /api/scan", async () => {
    const res = await request(app).get("/api/scan/some-project/some-device");
    expect(res.status).toBe(401);
  });

  it("mounts the homography router at /api/homography", async () => {
    const res = await request(app).get("/api/homography/has-local/some-device");
    expect(res.status).toBe(401);
  });

  it("mounts the scan-calibration router at /api/scan-calibration", async () => {
    // NOTE: 401 is deliberately NOT expected here - ScanCalibrationController carries no
    // [Authorize] on the old server and is ported that way, so this reaches the handler.
    // See the security note at the top of scanCalibration.routes.ts.
    const res = await request(app).post("/api/scan-calibration/p/d/combine").send({ Items: [] });
    expect(res.status).toBe(400);
    expect(res.text).toBe("At least two scans are required.");
  });

  it("does not let /api/scan-device fall through to the /api/scan mount", async () => {
    // Both are mounted; Express only matches a use() prefix at a "/" boundary, and this
    // pins that so reordering the mounts cannot silently shadow the hyphenated routes.
    const res = await request(app).get("/api/scan-device/some-device/next-scan");
    expect(res.status).toBe(401);
    expect(res.body.Message).toMatch(/device api key/i);
  });
});

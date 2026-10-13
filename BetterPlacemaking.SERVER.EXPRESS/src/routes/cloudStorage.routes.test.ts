import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createFakeStorage } from "../test/fakeStorage.js";

// cloudStorageRouter isn't wired into app.ts yet (that happens in a follow-up step once every
// ported resource lands), so these tests build a minimal app around the router directly rather
// than importing createApp from ../app.js.
const { cloudStorageRouter } = await import("./cloudStorage.routes.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { createUserToken } = await import("../services/tokenService.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/cloud-storage", cloudStorageRouter);
  app.use(errorHandler);
  return app;
}

function authHeader(): string {
  const { token } = createUserToken({ Id: "user-1", Email: "a@b.com", Role: "User" } as never);
  return `Bearer ${token}`;
}

let storage: ReturnType<typeof createFakeStorage>;

beforeEach(() => {
  storage = createFakeStorage();
});

describe("POST /api/cloud-storage/request-upload", () => {
  it("returns a signed upload URL for a sanitized object path when authenticated", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cloud-storage/request-upload")
      .set("Authorization", authHeader())
      .send({ PathFromRoot: "projects/proj-1/scans", FileName: "raw scan", Extension: "ply", SizeBytes: 1024 });

    expect(res.status).toBe(200);
    expect(res.body.PathFromRoot).toBe("projects/proj-1/scans/raw scan.ply");
    expect(res.body.SignedUrl).toContain("/object/upload/sign/");
    expect(res.body.ExpiresAt).toBeTruthy();
    expect(storage.bucket.createSignedUploadUrl).toHaveBeenCalledWith("projects/proj-1/scans/raw scan.ply", { upsert: true });
  });

  it("rejects requests without a valid bearer token", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cloud-storage/request-upload")
      .send({ PathFromRoot: "projects/proj-1/scans", FileName: "raw scan", Extension: "ply", SizeBytes: 1024 });

    expect(res.status).toBe(401);
    expect(storage.bucket.createSignedUploadUrl).not.toHaveBeenCalled();
    expect(storage.bucket.createSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects a non-positive SizeBytes with 400", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cloud-storage/request-upload")
      .set("Authorization", authHeader())
      .send({ PathFromRoot: "projects/proj-1/scans", FileName: "raw scan", Extension: "ply", SizeBytes: 0 });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/cloud-storage/request-download", () => {
  it("returns a signed download URL with a forced-download disposition when authenticated", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cloud-storage/request-download")
      .set("Authorization", authHeader())
      .send({ PathFromRoot: "projects/proj-1/scans/raw scan.ply" });

    expect(res.status).toBe(200);
    expect(res.body.PathFromRoot).toBe("projects/proj-1/scans/raw scan.ply");
    expect(res.body.SignedUrl).toContain("/object/sign/");
    expect(storage.bucket.createSignedUrl).toHaveBeenCalledWith(
      "projects/proj-1/scans/raw scan.ply",
      expect.any(Number),
      { download: "raw scan.ply" },
    );
  });

  it("rejects requests without a valid bearer token", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/cloud-storage/request-download")
      .send({ PathFromRoot: "projects/proj-1/scans/raw scan.ply" });

    expect(res.status).toBe(401);
    expect(storage.bucket.createSignedUploadUrl).not.toHaveBeenCalled();
    expect(storage.bucket.createSignedUrl).not.toHaveBeenCalled();
  });
});

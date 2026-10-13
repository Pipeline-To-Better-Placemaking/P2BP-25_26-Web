import express from "express";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db.js";
import { cameraIntrinsics, devices, intrinsicsSightings } from "../db/schema/index.js";
import type { Db } from "../db/client.js";

const { intrinsicsRouter } = await import("./intrinsics.routes.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { createUserToken } = await import("../services/tokenService.js");
const { computeApiKeyHash } = await import("../middleware/requireDeviceApiKey.js");

// intrinsicsRouter isn't mounted on the shared app yet (that wiring lands with
// app.ts separately), so tests exercise it standalone the same way createApp()
// would mount it: under /api/intrinsics with express.json() + errorHandler.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/intrinsics", intrinsicsRouter);
  app.use(errorHandler);
  return app;
}

function authHeader(): string {
  const { token } = createUserToken({ Id: "user-1", Email: "a@b.com", Role: "User" } as never);
  return `Bearer ${token}`;
}

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

async function seedDevice(id: string, rawApiKey: string): Promise<void> {
  await db.insert(devices).values({ id, apiKeyHash: computeApiKeyHash(rawApiKey) });
}

/** Seeds a camera_intrinsics row from the PascalCase doc shape these tests were written against. */
async function seedIntrinsics(
  id: string,
  doc: {
    ModelId?: string;
    DeviceId?: string;
    CameraMac?: string;
    IsPerUnit: boolean;
    CameraMatrixFlat: number[];
    DistortionCoefficients: number[];
    ReprojectionError: number;
    SightingsUsed: number;
    ComputedAtUnix: number;
  },
): Promise<void> {
  await db.insert(cameraIntrinsics).values({
    id,
    modelId: doc.ModelId ?? null,
    deviceId: doc.DeviceId ?? null,
    cameraMac: doc.CameraMac ?? null,
    isPerUnit: doc.IsPerUnit,
    cameraMatrixFlat: doc.CameraMatrixFlat,
    distortionCoefficients: doc.DistortionCoefficients,
    reprojectionError: doc.ReprojectionError,
    sightingsUsed: doc.SightingsUsed,
    computedAtUnix: doc.ComputedAtUnix,
  });
}

describe("POST /api/intrinsics/submit-sightings", () => {
  it("stores one sighting doc per submitted sighting under a device API key", async () => {
    await seedDevice("device-1", "raw-key-1");
    const app = buildApp();

    const res = await request(app)
      .post("/api/intrinsics/submit-sightings")
      .set("Authorization", "Bearer raw-key-1")
      .send({
        CameraMac: "AA:BB:CC:DD:EE:FF",
        IsPerUnit: true,
        Sightings: [
          {
            CornerCount: 4,
            ImagePoints: [
              [1, 2],
              [3, 4],
            ],
            CornerIds: [0, 1],
            FrameSize: [1920, 1080],
            Rmse: 0.5,
            CapturedAt: "2024-01-01T00:00:00+00:00",
          },
          {
            CornerCount: 4,
            ImagePoints: [[5, 6]],
            CornerIds: [2],
            FrameSize: [1920, 1080],
            Rmse: 0.6,
            CapturedAt: "2024-01-01T00:00:01+00:00",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ SightingsStored: 2 });

    const rows = await db.select().from(intrinsicsSightings);
    expect(rows).toHaveLength(2);
    expect(rows[0].deviceId).toBe("device-1");
    expect(rows[0].imagePoints).toBeTruthy();
  });

  it("normalizes CameraMac to lowercase and persists sighting fields", async () => {
    await seedDevice("device-2", "raw-key-2");
    const app = buildApp();

    const res = await request(app)
      .post("/api/intrinsics/submit-sightings")
      .set("Authorization", "Bearer raw-key-2")
      .send({
        CameraMac: "AA:BB:CC:DD:EE:FF",
        IsPerUnit: false,
        ModelId: "model-x",
        Sightings: [
          {
            CornerCount: 4,
            ImagePoints: [[1, 2]],
            CornerIds: [0],
            FrameSize: [640, 480],
            Rmse: 0.1,
            CapturedAt: "2024-01-01T00:00:00+00:00",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ SightingsStored: 1 });

    const [row] = await db.select().from(intrinsicsSightings);
    expect(row.cameraMac).toBe("aa:bb:cc:dd:ee:ff");
    expect(row.modelId).toBe("model-x");
    expect(row.isPerUnit).toBe(false);
  });

  it("rejects requests without a valid device API key", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/api/intrinsics/submit-sightings")
      .set("Authorization", "Bearer not-a-real-key")
      .send({ CameraMac: "AA:BB:CC:DD:EE:FF", IsPerUnit: true, Sightings: [] });

    expect(res.status).toBe(401);
  });

  it("rejects requests with no Authorization header at all", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/api/intrinsics/submit-sightings")
      .send({ CameraMac: "AA:BB:CC:DD:EE:FF", IsPerUnit: true, Sightings: [] });

    expect(res.status).toBe(401);
  });
});

describe("POST /api/intrinsics/submit-result", () => {
  it("stores a per-unit result keyed by deviceId_mac and returns the unflattened matrix", async () => {
    await seedDevice("device-3", "raw-key-3");
    const app = buildApp();

    const res = await request(app)
      .post("/api/intrinsics/submit-result")
      .set("Authorization", "Bearer raw-key-3")
      .send({
        CameraMac: "AA:BB:CC:DD:EE:FF",
        IsPerUnit: true,
        CameraMatrix: [
          [1000, 0, 960],
          [0, 1000, 540],
          [0, 0, 1],
        ],
        DistortionCoefficients: [0.1, 0.2, 0, 0, 0],
        ReprojectionError: 0.35,
        SightingsUsed: 12,
      });

    expect(res.status).toBe(200);
    expect(res.body.Id).toBe("device-3_aa:bb:cc:dd:ee:ff");
    expect(res.body.IsPerUnit).toBe(true);
    expect(res.body.CameraMatrix).toEqual([
      [1000, 0, 960],
      [0, 1000, 540],
      [0, 0, 1],
    ]);
    expect(res.body.DistortionCoefficients).toEqual([0.1, 0.2, 0, 0, 0]);
    expect(typeof res.body.ComputedAtUnix).toBe("number");

    const [storedRaw] = await db
      .select()
      .from(cameraIntrinsics)
      .where(eq(cameraIntrinsics.id, "device-3_aa:bb:cc:dd:ee:ff"));
    expect(storedRaw?.cameraMatrixFlat).toEqual([1000, 0, 960, 0, 1000, 540, 0, 0, 1]);
  });

  it("stores a model-level result keyed by ModelId when IsPerUnit is false", async () => {
    await seedDevice("device-4", "raw-key-4");
    const app = buildApp();

    const res = await request(app)
      .post("/api/intrinsics/submit-result")
      .set("Authorization", "Bearer raw-key-4")
      .send({
        CameraMac: "11:22:33:44:55:66",
        IsPerUnit: false,
        ModelId: "camera-model-x",
        CameraMatrix: [
          [500, 0, 320],
          [0, 500, 240],
          [0, 0, 1],
        ],
        DistortionCoefficients: [0, 0, 0, 0, 0],
        ReprojectionError: 0.2,
        SightingsUsed: 20,
      });

    expect(res.status).toBe(200);
    expect(res.body.Id).toBe("camera-model-x");
    expect(res.body.ModelId).toBe("camera-model-x");
    expect(res.body.CameraMac).toBeNull();
  });

  it("rejects requests without a valid device API key", async () => {
    const app = buildApp();

    const res = await request(app).post("/api/intrinsics/submit-result").send({
      CameraMac: "AA:BB:CC:DD:EE:FF",
      IsPerUnit: true,
      CameraMatrix: [],
      DistortionCoefficients: [],
      ReprojectionError: 0,
      SightingsUsed: 0,
    });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/intrinsics/:deviceId/:mac", () => {
  it("returns the per-unit result for an authenticated user", async () => {
    await seedIntrinsics("device-5_aa:bb:cc:dd:ee:ff", {
      DeviceId: "device-5",
      CameraMac: "aa:bb:cc:dd:ee:ff",
      IsPerUnit: true,
      CameraMatrixFlat: [1000, 0, 960, 0, 1000, 540, 0, 0, 1],
      DistortionCoefficients: [0.1, 0.2, 0, 0, 0],
      ReprojectionError: 0.35,
      SightingsUsed: 12,
      ComputedAtUnix: 1700000000,
    });
    const app = buildApp();

    const res = await request(app)
      .get("/api/intrinsics/device-5/AA:BB:CC:DD:EE:FF")
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body.Id).toBe("device-5_aa:bb:cc:dd:ee:ff");
    expect(res.body.CameraMatrix).toEqual([
      [1000, 0, 960],
      [0, 1000, 540],
      [0, 0, 1],
    ]);
  });

  it("falls back to the model-level result when no per-unit record exists and modelId is given", async () => {
    await seedIntrinsics("model-fallback", {
      ModelId: "model-fallback",
      IsPerUnit: false,
      CameraMatrixFlat: [500, 0, 320, 0, 500, 240, 0, 0, 1],
      DistortionCoefficients: [0, 0, 0, 0, 0],
      ReprojectionError: 0.2,
      SightingsUsed: 20,
      ComputedAtUnix: 1700000001,
    });
    const app = buildApp();

    const res = await request(app)
      .get("/api/intrinsics/device-with-no-record/11:22:33:44:55:66")
      .query({ modelId: "model-fallback" })
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body.Id).toBe("model-fallback");
  });

  it("returns 404 when nothing matches", async () => {
    const app = buildApp();

    const res = await request(app)
      .get("/api/intrinsics/unknown-device/00:00:00:00:00:00")
      .set("Authorization", authHeader());

    expect(res.status).toBe(404);
  });

  it("rejects unauthenticated requests", async () => {
    const app = buildApp();

    const res = await request(app).get("/api/intrinsics/device-5/AA:BB:CC:DD:EE:FF");

    expect(res.status).toBe(401);
  });
});

describe("GET /api/intrinsics/model/:modelId", () => {
  it("returns the model-level result for an authenticated user", async () => {
    await seedIntrinsics("model-lookup", {
      ModelId: "model-lookup",
      IsPerUnit: false,
      CameraMatrixFlat: [500, 0, 320, 0, 500, 240, 0, 0, 1],
      DistortionCoefficients: [0, 0, 0, 0, 0],
      ReprojectionError: 0.2,
      SightingsUsed: 20,
      ComputedAtUnix: 1700000002,
    });
    const app = buildApp();

    const res = await request(app)
      .get("/api/intrinsics/model/model-lookup")
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body.Id).toBe("model-lookup");
    expect(res.body.ModelId).toBe("model-lookup");
  });

  it("returns 404 when the model has no stored intrinsics", async () => {
    const app = buildApp();

    const res = await request(app)
      .get("/api/intrinsics/model/no-such-model")
      .set("Authorization", authHeader());

    expect(res.status).toBe(404);
  });

  it("rejects unauthenticated requests", async () => {
    const app = buildApp();

    const res = await request(app).get("/api/intrinsics/model/model-lookup");

    expect(res.status).toBe(401);
  });
});

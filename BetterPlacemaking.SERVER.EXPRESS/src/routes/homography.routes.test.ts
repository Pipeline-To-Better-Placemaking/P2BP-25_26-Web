import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db.js";
import {
  arucoSessions,
  arucoSightings,
  devices,
  globalHomographies,
  localHomographies,
  lockedHomographies,
  projects,
} from "../db/schema/index.js";
import type { Db } from "../db/client.js";

const hasGlobalPermission = vi.fn(async () => false);
const hasProjectPermission = vi.fn(
  async (_userId: string, _role: string | undefined, projectId: string) => projectId === "proj-1",
);

vi.mock("../authorization/authorizationService.js", () => ({
  hasGlobalPermission: (...args: unknown[]) => hasGlobalPermission(...(args as [string, string | undefined, string])),
  hasProjectPermission: (...args: unknown[]) =>
    hasProjectPermission(...(args as [string, string | undefined, string, string])),
  getEffectiveGlobalPermissions: async () => [],
  getEffectiveProjectPermissions: async () => [],
  getProjectRoleOptions: async () => [],
}));

const { homographyRouter } = await import("./homography.routes.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { createUserToken } = await import("../services/tokenService.js");
const { computeApiKeyHash } = await import("../middleware/requireDeviceApiKey.js");
const { flattenMatrix3x3, unflattenMatrix3x3 } = await import("../models/homography.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/homography", homographyRouter);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

function authHeader(userId = "user-1"): string {
  const { token } = createUserToken({ Id: userId, Email: "a@b.com", Role: "User" } as never);
  return `Bearer ${token}`;
}

const DEVICE_KEY = "raw-device-api-key";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(projects).values([
    { id: "proj-1", title: "P1" },
    { id: "proj-other", title: "PO" },
  ]);
  await db.insert(devices).values({
    id: "dev-1",
    apiKeyHash: computeApiKeyHash(DEVICE_KEY),
    projectId: "proj-1",
    name: "Jetson 1",
  });
});

const validLocalDto = {
  CameraMac: "AA:BB:CC:DD:EE:FF",
  Matrix: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  FrameSize: [1920, 1080],
  Inliers: 40,
  RmseBoard: 0.3,
  CornersUsed: 24,
  MarkersDetected: 12,
  ArucoDict: "DICT_4X4_50",
  SquaresX: 5,
  SquaresY: 7,
  SquareLength: 0.04,
  MarkerLength: 0.02,
  TimestampUnix: 1_700_000_000,
};

// ---------------------------------------------------------------------------
// Matrix helpers - the numeric plumbing every other endpoint depends on.
// ---------------------------------------------------------------------------
describe("matrix flatten/unflatten round trip", () => {
  it("flattens row-major and restores the same matrix", () => {
    const m = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];

    expect(flattenMatrix3x3(m)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(unflattenMatrix3x3(flattenMatrix3x3(m))).toEqual(m);
  });

  it("returns null for absent input rather than a malformed matrix", () => {
    expect(flattenMatrix3x3(null)).toBeNull();
    expect(unflattenMatrix3x3(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Device-authenticated endpoints (DeviceApiKey policy).
// ---------------------------------------------------------------------------
describe("POST /api/homography/submit-local", () => {
  it("rejects a request with no device API key", async () => {
    const res = await request(app).post("/api/homography/submit-local").send(validLocalDto);
    expect(res.status).toBe(401);
  });

  it("rejects an unknown device API key", async () => {
    const res = await request(app)
      .post("/api/homography/submit-local")
      .set("Authorization", "Bearer not-a-real-key")
      .send(validLocalDto);
    expect(res.status).toBe(401);
  });

  it("stores the local homography under {deviceId}_{normalizedMac}", async () => {
    const res = await request(app)
      .post("/api/homography/submit-local")
      .set("Authorization", `Bearer ${DEVICE_KEY}`)
      .send(validLocalDto);

    expect(res.status).toBe(200);
    expect(res.body.CameraMac).toBeTruthy();
    expect(res.body.HomographyId).toContain("dev-1");

    const [stored] = await db
      .select()
      .from(localHomographies)
      .where(eq(localHomographies.id, "dev-1_aa:bb:cc:dd:ee:ff"));
    expect(stored.matrixFlat).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(stored.deviceId).toBe("dev-1");
    expect(stored.frameSize).toEqual([1920, 1080]);
  });

  it("upserts when the same camera submits again", async () => {
    const send = (rmse: number) =>
      request(app)
        .post("/api/homography/submit-local")
        .set("Authorization", `Bearer ${DEVICE_KEY}`)
        .send({ ...validLocalDto, RmseBoard: rmse });
    expect((await send(0.3)).status).toBe(200);
    expect((await send(0.1)).status).toBe(200);

    const rows = await db.select().from(localHomographies);
    expect(rows).toHaveLength(1);
    expect(rows[0].rmseBoard).toBe(0.1);
  });

  it("rejects an empty payload", async () => {
    const res = await request(app)
      .post("/api/homography/submit-local")
      .set("Authorization", `Bearer ${DEVICE_KEY}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.text).toBe("Invalid payload.");
  });

  it("rejects a payload missing the Matrix", async () => {
    const { Matrix: _omitted, ...withoutMatrix } = validLocalDto;
    const res = await request(app)
      .post("/api/homography/submit-local")
      .set("Authorization", `Bearer ${DEVICE_KEY}`)
      .send(withoutMatrix);

    expect(res.status).toBe(400);
    expect(res.text).toBe("Invalid payload.");
  });
});

describe("POST /api/homography/submit-sightings", () => {
  it("rejects a request with no device API key", async () => {
    const res = await request(app)
      .post("/api/homography/submit-sightings")
      .send({ CameraMac: "AA:BB:CC:DD:EE:FF", ArucoDict: "DICT_4X4_50", CapturedAt: "2026-01-01T00:00:00Z", Markers: [] });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// User-authenticated endpoints (UserJwt policy).
// ---------------------------------------------------------------------------
describe("GET /api/homography/has-local/:deviceId", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/homography/has-local/dev-1");
    expect(res.status).toBe(401);
  });

  it("reports false for a device with no stored homography", async () => {
    const res = await request(app).get("/api/homography/has-local/dev-unknown").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ HasLocalHomography: false });
  });

  it("reports true once a local homography exists", async () => {
    await request(app)
      .post("/api/homography/submit-local")
      .set("Authorization", `Bearer ${DEVICE_KEY}`)
      .send(validLocalDto);

    const res = await request(app).get("/api/homography/has-local/dev-1").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ HasLocalHomography: true });
  });
});

describe("GET /api/homography/intrinsics/:deviceId/:mac", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/homography/intrinsics/dev-1/AA:BB:CC:DD:EE:FF");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the device/camera has no stored intrinsics", async () => {
    const res = await request(app)
      .get("/api/homography/intrinsics/dev-unknown/AA:BB:CC:DD:EE:FF")
      .set("Authorization", authHeader());

    expect(res.status).toBe(404);
    expect(res.text).toBe("No intrinsics found for the given device and camera.");
  });
});

describe("GET /api/homography/session-status/:sessionId", () => {
  it("returns 404 for an unknown session (KeyNotFoundException -> NotFound)", async () => {
    const res = await request(app).get("/api/homography/session-status/no-such-session").set("Authorization", authHeader());

    expect(res.status).toBe(404);
    expect(res.text).toMatch(/not found/i);
  });
});

describe("GET /api/homography/snapshot-url/:deviceId/:cameraMac", () => {
  it("returns 200 with a null url when no snapshot is stored, not a 404", async () => {
    const res = await request(app)
      .get("/api/homography/snapshot-url/dev-unknown/AA:BB:CC:DD:EE:FF")
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ SnapshotUrl: null });
  });
});

describe("POST /api/homography/compute-lock", () => {
  it("requires authentication", async () => {
    const res = await request(app).post("/api/homography/compute-lock");
    expect(res.status).toBe(401);
  });

  it("maps a lock failure to 422, matching UnprocessableEntity(ex.Message)", async () => {
    // No ArUco sightings have been recorded, so runBfsLock throws the
    // InvalidOperationException-equivalent HomographyLockError.
    const res = await request(app).post("/api/homography/compute-lock").set("Authorization", authHeader());

    expect(res.status).toBe(422);
    expect(res.text).toMatch(/sightings|cameras/i);
  });
});

// ---------------------------------------------------------------------------
// Project-scoped workspace endpoints (UserJwt + [RequirePermission]).
// ---------------------------------------------------------------------------
describe("GET /api/homography/workspace/:projectId", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/homography/workspace/proj-1");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a project the caller has no permission on", async () => {
    const res = await request(app).get("/api/homography/workspace/proj-other").set("Authorization", authHeader());
    expect(res.status).toBe(403);
  });

  it("returns the workspace for a permitted project", async () => {
    const res = await request(app).get("/api/homography/workspace/proj-1").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(hasProjectPermission).toHaveBeenCalled();
    expect(res.body).toHaveProperty("PuzzlePieces");
  });
});

describe("POST /api/homography/workspace/:projectId/puzzle-pieces/refresh", () => {
  it("returns 403 without Project.Update on that project", async () => {
    const res = await request(app)
      .post("/api/homography/workspace/proj-other/puzzle-pieces/refresh")
      .set("Authorization", authHeader());

    expect(res.status).toBe(403);
  });
});

describe("GET /api/homography/workspace/:projectId/puzzle-pieces/:deviceId/:cameraMac", () => {
  it("returns 404 when the device has no local homography (KeyNotFoundException -> NotFound)", async () => {
    const res = await request(app)
      .get("/api/homography/workspace/proj-1/puzzle-pieces/dev-unknown/AA:BB:CC:DD:EE:FF")
      .set("Authorization", authHeader());

    expect(res.status).toBe(404);
  });
});

describe("POST /api/homography/workspace/:projectId/global-homographies", () => {
  it("returns 403 without Project.Update on that project", async () => {
    const res = await request(app)
      .post("/api/homography/workspace/proj-other/global-homographies")
      .set("Authorization", authHeader())
      .send({ MmPerFpPx: 1, Placements: [] });

    expect(res.status).toBe(403);
  });

  it("maps a validation failure to 400 (ArgumentException -> BadRequest)", async () => {
    const res = await request(app)
      .post("/api/homography/workspace/proj-1/global-homographies")
      .set("Authorization", authHeader())
      .send({ MmPerFpPx: 0, Placements: [] });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/MmPerFpPx/);
  });
});


// ---------------------------------------------------------------------------
// DB-backed flows: ArUco sessions, BFS lock, global homographies, puzzle workspace.
// ---------------------------------------------------------------------------
async function submitLocal(mac: string) {
  return request(app)
    .post("/api/homography/submit-local")
    .set("Authorization", `Bearer ${DEVICE_KEY}`)
    .send({ ...validLocalDto, CameraMac: mac });
}

/** The server-computed hash of the camera's current local homography, read back via the workspace endpoint. */
async function localHash(): Promise<string> {
  const ws = await request(app).get("/api/homography/workspace/proj-1").set("Authorization", authHeader());
  return ws.body.LocalHomographies[0].LocalHomographyHash as string;
}

describe("ArUco sighting sessions", () => {
  const markers = [
    {
      MarkerId: 1,
      CornersPx: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    },
  ];

  it("creates a session on first camera, then joins it for the second and reports status", async () => {
    const first = await request(app)
      .post("/api/homography/submit-sightings")
      .set("Authorization", `Bearer ${DEVICE_KEY}`)
      .send({ CameraMac: "AA:00:00:00:00:01", ArucoDict: "DICT_4X4_50", CapturedAt: "t1", Markers: markers });
    expect(first.status).toBe(200);
    expect(first.body.CamerasTotal).toBe(1);
    const sessionId = first.body.SessionId as string;

    const second = await request(app)
      .post("/api/homography/submit-sightings")
      .set("Authorization", `Bearer ${DEVICE_KEY}`)
      .send({
        SessionId: sessionId,
        CameraMac: "AA:00:00:00:00:02",
        ArucoDict: "DICT_4X4_50",
        CapturedAt: "t2",
        Markers: markers,
      });
    expect(second.body).toMatchObject({ SessionId: sessionId, CamerasTotal: 2 });
    expect(second.body.CamerasCheckedIn).toEqual(["aa:00:00:00:00:01", "aa:00:00:00:00:02"]);

    const status = await request(app)
      .get(`/api/homography/session-status/${sessionId}`)
      .set("Authorization", authHeader());
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ SessionId: sessionId, Status: "collecting", CamerasTotal: 2 });
    expect(new Date(status.body.CreatedAt).toString()).not.toBe("Invalid Date");

    const sightings = await db.select().from(arucoSightings);
    expect(sightings).toHaveLength(2);
    expect(sightings[0].markers?.[0].CornersPxFlat).toEqual([0, 0, 10, 0, 10, 10, 0, 10]);
  });
});

describe("POST /api/homography/compute-lock with stored sightings", () => {
  it("locks a single camera with an identity transform and writes Config.ArucoLock on the device", async () => {
    await submitLocal("AA:00:00:00:00:01");
    const hash = await localHash();

    await request(app)
      .post("/api/homography/submit-sightings")
      .set("Authorization", `Bearer ${DEVICE_KEY}`)
      .send({
        CameraMac: "AA:00:00:00:00:01",
        ArucoDict: "DICT_4X4_50",
        CapturedAt: "t1",
        LocalHomographyHash: hash,
        Markers: [{ MarkerId: 1, CornersPx: [[0, 0], [1, 0], [1, 1], [0, 1]] }],
      });

    const res = await request(app).post("/api/homography/compute-lock").set("Authorization", authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ Status: "locked", CamerasComputed: 1 });

    const [locked] = await db.select().from(lockedHomographies);
    expect(locked.id).toBe("dev-1_aa:00:00:00:00:01");
    expect(locked.matrixFlat).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    const [device] = await db.select().from(devices).where(eq(devices.id, "dev-1"));
    const aruco = (device.config as { ArucoLock: { Status: string; LastRunUnix: number } }).ArucoLock;
    expect(aruco.Status).toBe("locked");
    expect(typeof aruco.LastRunUnix).toBe("number");
  });

  it("returns 422 and leaves the device untouched when no sighting matches a current homography", async () => {
    await submitLocal("AA:00:00:00:00:01");
    await request(app)
      .post("/api/homography/submit-sightings")
      .set("Authorization", `Bearer ${DEVICE_KEY}`)
      .send({
        CameraMac: "AA:00:00:00:00:01",
        ArucoDict: "DICT_4X4_50",
        CapturedAt: "t1",
        LocalHomographyHash: "stale-hash",
        Markers: [],
      });

    const res = await request(app).post("/api/homography/compute-lock").set("Authorization", authHeader());
    expect(res.status).toBe(422);

    const [device] = await db.select().from(devices).where(eq(devices.id, "dev-1"));
    // runBfsLock throws before any camera->device mapping is returned, so no status is written (as before).
    expect(device.config).toBeNull();
  });
});

describe("global homographies + puzzle workspace", () => {
  const placement = {
    PuzzlePieceId: "pp-1",
    DeviceId: "dev-1",
    CameraMac: "AA:00:00:00:00:01",
    CenterFp: [100, 100],
    AngleDeg: 0,
    Scale: 1,
    HLocalCanvas: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    LocalCanvasSize: [200, 100],
  };

  it("saves global homographies, upserts them, and returns them in the workspace", async () => {
    const save = () =>
      request(app)
        .post("/api/homography/workspace/proj-1/global-homographies")
        .set("Authorization", authHeader())
        .send({
          MmPerFpPx: 2,
          OriginFp: [0, 0],
          FloorplanSize: [1000, 800],
          Placements: [placement],
          LockedGroups: [{ GroupId: "g1", CameraMacs: ["AA:00:00:00:00:01", "aa:00:00:00:00:01"] }],
        });

    const first = await save();
    expect(first.status).toBe(200);
    expect(first.body.PlacementsSaved).toBe(1);
    expect(first.body.GlobalHomographies.LockedGroups).toEqual([{ GroupId: "g1", CameraMacs: ["aa:00:00:00:00:01"] }]);
    expect((await save()).status).toBe(200);

    const rows = await db.select().from(globalHomographies);
    expect(rows).toHaveLength(1);
    expect(rows[0].projectId).toBe("proj-1");

    await submitLocal("AA:00:00:00:00:01");
    const ws = await request(app).get("/api/homography/workspace/proj-1").set("Authorization", authHeader());
    expect(ws.status).toBe(200);
    expect(ws.body.GlobalHomographies.Placements).toHaveLength(1);
    expect(ws.body.LocalHomographies).toHaveLength(1);
    expect(ws.body.LocalHomographies[0]).toMatchObject({ DeviceId: "dev-1", CameraMac: "aa:00:00:00:00:01" });
    expect(ws.body.PuzzlePieces[0].Status).toBe("missing_snapshot");
    expect(ws.body.LockedGroups).toHaveLength(1);
  });

  it("looks up a single puzzle piece for a device in the project and 404s for other projects", async () => {
    await submitLocal("AA:00:00:00:00:01");
    const ok = await request(app)
      .get("/api/homography/workspace/proj-1/puzzle-pieces/dev-1/AA:00:00:00:00:01")
      .set("Authorization", authHeader());
    expect(ok.status).toBe(200);
    expect(ok.body.DeviceId).toBe("dev-1");

    hasProjectPermission.mockImplementationOnce(async () => true);
    const other = await request(app)
      .get("/api/homography/workspace/proj-other/puzzle-pieces/dev-1/AA:00:00:00:00:01")
      .set("Authorization", authHeader());
    expect(other.status).toBe(404);
  });
});

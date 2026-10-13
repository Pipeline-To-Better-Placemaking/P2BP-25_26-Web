import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * rplidarRouter is not yet mounted in app.ts (a separate wiring step, out of
 * scope for this port - see rplidar.routes.ts), so this builds a minimal app
 * around the router directly, same pattern tracking.routes.test.ts and
 * scanDevice.routes.test.ts use.
 *
 * RPLIDAR_SCAN_DIRECTORY must be set before config/env.ts (and anything
 * importing it) is first loaded, since env.ts snapshots process.env into a
 * static object at import time - same constraint tracking.routes.test.ts notes
 * for TRACKING_POSITIONS_CSV/TRACKING_TRACKS_DIR.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rplidar-test-"));
process.env.RPLIDAR_SCAN_DIRECTORY = tmpDir;

const { rplidarRouter } = await import("./rplidar.routes.js");
// Loaded after RPLIDAR_SCAN_DIRECTORY is set: these transitively import env.ts.
const { createTestDb } = await import("../test/db.js");
const { setDbForTesting } = await import("../db/client.js");
const visualizerSessionService = await import("../services/visualizerSessionService.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { createUserToken } = await import("../services/tokenService.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/rplidar", rplidarRouter);
  app.use(errorHandler);
  return app;
}

function authHeader(): string {
  const { token } = createUserToken({ Id: "user-1", Email: "a@b.com", Role: "User" } as never);
  return `Bearer ${token}`;
}

function writeXyz(filename: string, points: [number, number, number][]): string {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, points.map(([x, y, z]) => `${x} ${y} ${z}`).join("\n"));
  return filePath;
}

function clearScans() {
  for (const f of fs.readdirSync(tmpDir)) {
    fs.rmSync(path.join(tmpDir, f));
  }
}

beforeEach(() => {
  clearScans();
});

beforeAll(async () => {
  await createTestDb();
});

afterAll(() => {
  setDbForTesting(null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Hand-computed scan fixture exercising the core floor/obstacle/ceiling
 * classification and pass-1 grid clustering with the *default* RplidarScan
 * config (FloorThreshold=-4.3, CeilingThreshold=-1.0, ClusterGridSize=0.4,
 * MinClusterPoints=10, WallMargin=0.8, ScannerExclusionRadius=2.0,
 * GroundContactMargin=0.9, MaxObstacleDimension=5.0 - see env.ts/.env.example).
 *
 * - 25 floor points: a 5x5 grid at Z=-5.0 (< FloorThreshold) spanning exactly
 *   X,Y in [-5, 5], so avgFloorZ = -5.0 exactly and the floor's XY bounding box
 *   is exactly [-5,5]x[-5,5].
 * - 4 ceiling points: the room's four top corners at Z=0 (>= CeilingThreshold).
 * - 12 obstacle points: a 3x4 grid (X in {1.8,2.0,2.2}, Y in {1.8,2.0,2.2,2.4})
 *   all at Z=-4.2 (in [FloorThreshold, CeilingThreshold)). All 12 are >0.8m
 *   inside the floor bbox edges (clears WallMargin) and >2.0m from the origin
 *   (clears ScannerExclusionRadius; nearest point (1.8,1.8) is
 *   sqrt(1.8^2+1.8^2)=2.545m out), and fall in two adjacent 0.4m grid cells
 *   (8-connected -> one cluster). clusterMinZ=-4.2 < groundContactThreshold
 *   (avgFloorZ + GroundContactMargin = -5.0+0.9 = -4.1) so it passes the
 *   ground-contact check; width=0.4/depth=0.6 both clear MaxObstacleDimension.
 *   => exactly one pass-1 "obstacle" cluster:
 *     CenterX=2.0 (mean of {1.8,2.0,2.2}), CenterY=2.1 (mean of
 *     {1.8,2.0,2.2,2.4}), Min/MaxX=1.8/2.2, Min/MaxY=1.8/2.4,
 *     AvgHeight=MaxHeight=Z-avgFloorZ=-4.2-(-5.0)=0.8, PointCount=12,
 *     Width=0.4, Depth=0.6, Type="obstacle", RotationDeg=0.
 *
 * The 25 floor points at Z=-5.0 also satisfy DetectLowProfileObstacles's
 * floorPoints3D band ([FloorThreshold-0.7, FloorThreshold) = [-5.0,-4.3)) but
 * there are only 25 of them, under its Count<100 bailout, so pass 2 (low-profile
 * detection) contributes nothing here - the single pass-1 cluster above is the
 * whole Clusters array.
 */
function buildFixturePoints(): [number, number, number][] {
  const points: [number, number, number][] = [];

  const floorCoords = [-5, -2.5, 0, 2.5, 5];
  for (const x of floorCoords) {
    for (const y of floorCoords) {
      points.push([x, y, -5.0]);
    }
  }

  for (const [x, y] of [
    [-5, -5],
    [-5, 5],
    [5, -5],
    [5, 5],
  ] as const) {
    points.push([x, y, 0]);
  }

  const obsX = [1.8, 2.0, 2.2];
  const obsY = [1.8, 2.0, 2.2, 2.4];
  for (const x of obsX) {
    for (const y of obsY) {
      points.push([x, y, -4.2]);
    }
  }

  return points;
}

const EXPECTED_CLUSTER = {
  Id: 0,
  CenterX: 2.0,
  CenterY: 2.1,
  MinX: 1.8,
  MaxX: 2.2,
  MinY: 1.8,
  MaxY: 2.4,
  AvgHeight: 0.8,
  MaxHeight: 0.8,
  PointCount: 12,
  Width: 0.4,
  Depth: 0.6,
  Type: "obstacle",
  RotationDeg: 0,
};

describe("GET /api/rplidar/scans/:filename", () => {
  it("401s without a bearer token", async () => {
    const res = await request(buildApp()).get("/api/rplidar/scans/none.xyz");
    expect(res.status).toBe(401);
  });

  it("404s with an error body for a scan file that doesn't exist", async () => {
    const res = await request(buildApp()).get("/api/rplidar/scans/missing.xyz").set("Authorization", authHeader());
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Scan file 'missing.xyz' not found" });
  });

  it("classifies floor/obstacle/ceiling points and produces the hand-computed obstacle cluster", async () => {
    writeXyz("room.xyz", buildFixturePoints());

    const res = await request(buildApp()).get("/api/rplidar/scans/room.xyz").set("Authorization", authHeader());

    expect(res.status).toBe(200);

    // Classification counts (no subsampling: 25/4/12 are all under the default caps).
    expect(res.body.floor).toHaveLength(25);
    expect(res.body.ceiling).toHaveLength(4);
    expect(res.body.obstacles).toHaveLength(12);

    // Exactly the one hand-computed pass-1 cluster.
    expect(res.body.clusters).toEqual([EXPECTED_CLUSTER]);

    // clusterPoints is the same 12 obstacle points (order not guaranteed - grid
    // flood-fill traversal order, not input order), compared as an unordered set.
    const sortPoints = (pts: number[][]) => [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(sortPoints(res.body.clusterPoints)).toEqual(sortPoints(res.body.obstacles));

    // Meta: avgFloorZ=-5.0 exactly; CeilingHeight = |avgFloorZ| = 5.0 (not
    // derived from CeilingThreshold - see models/rplidar.ts); ScanRadius = the
    // farthest horizontal distance seen, from the (+-5,+-5) floor/ceiling
    // corners: sqrt(5^2+5^2) = 7.0710... -> 7.07.
    expect(res.body.meta).toEqual({
      TotalPoints: 41,
      FloorZ: -5,
      CeilingHeight: 5,
      ScanRadius: 7.07,
      FloorThreshold: -4.3,
      CeilingThreshold: -1.0,
    });
  });

  it("accepts maxFloorPoints/maxCeilingPoints but ignores floorThreshold/ceilingThreshold query params (ported gap - see rplidar.routes.ts)", async () => {
    writeXyz("room2.xyz", buildFixturePoints());

    const res = await request(buildApp())
      .get("/api/rplidar/scans/room2.xyz?floorThreshold=-1&ceilingThreshold=0&maxFloorPoints=3&maxCeilingPoints=2")
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    // Subsampling caps applied...
    expect(res.body.floor).toHaveLength(3);
    expect(res.body.ceiling).toHaveLength(2);
    // ...but classification itself is unaffected by floorThreshold/ceilingThreshold:
    // still the default -4.3/-1.0 thresholds and the same single cluster.
    expect(res.body.meta.FloorThreshold).toBe(-4.3);
    expect(res.body.meta.CeilingThreshold).toBe(-1.0);
    expect(res.body.clusters).toEqual([EXPECTED_CLUSTER]);
  });

  it("404s on a path-traversal filename instead of reading outside the scan directory", async () => {
    const res = await request(buildApp())
      .get("/api/rplidar/scans/..%2F..%2F..%2Fetc%2Fpasswd")
      .set("Authorization", authHeader());

    expect(res.status).toBe(404);
  });
});

describe("GET /api/rplidar/scans/:filename/obstacles", () => {
  it("401s without a bearer token", async () => {
    const res = await request(buildApp()).get("/api/rplidar/scans/room.xyz/obstacles");
    expect(res.status).toBe(401);
  });

  it("404s for a missing scan file", async () => {
    const res = await request(buildApp()).get("/api/rplidar/scans/missing.xyz/obstacles").set("Authorization", authHeader());
    expect(res.status).toBe(404);
  });

  it("returns just the clusters array", async () => {
    writeXyz("room.xyz", buildFixturePoints());
    const res = await request(buildApp()).get("/api/rplidar/scans/room.xyz/obstacles").set("Authorization", authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([EXPECTED_CLUSTER]);
  });
});

describe("GET /api/rplidar/scans/:filename/floorplan", () => {
  it("401s without a bearer token", async () => {
    const res = await request(buildApp()).get("/api/rplidar/scans/room.xyz/floorplan");
    expect(res.status).toBe(401);
  });

  it("returns the floor bounding box and a summarized obstacle list", async () => {
    writeXyz("room.xyz", buildFixturePoints());
    const res = await request(buildApp()).get("/api/rplidar/scans/room.xyz/floorplan").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body.floorBounds).toEqual({ minX: -5, maxX: 5, minY: -5, maxY: 5 });
    expect(res.body.obstacles).toEqual([
      {
        Id: 0,
        Type: "obstacle",
        CenterX: 2.0,
        CenterY: 2.1,
        MinX: 1.8,
        MaxX: 2.2,
        MinY: 1.8,
        MaxY: 2.4,
        Width: 0.4,
        Depth: 0.6,
        AvgHeight: 0.8,
        MaxHeight: 0.8,
      },
    ]);
    expect(res.body.meta.TotalPoints).toBe(41);
  });
});

describe("GET /api/rplidar/scans", () => {
  it("401s without a bearer token", async () => {
    const res = await request(buildApp()).get("/api/rplidar/scans");
    expect(res.status).toBe(401);
  });

  it("returns an empty array when the scan directory has no .xyz files", async () => {
    const res = await request(buildApp()).get("/api/rplidar/scans").set("Authorization", authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("lists .xyz files newest-modified-first, ignoring non-.xyz files", async () => {
    writeXyz("older.xyz", [[0, 0, 0]]);
    const olderPath = path.join(tmpDir, "older.xyz");
    const oldTime = new Date("2026-01-01T00:00:00Z");
    fs.utimesSync(olderPath, oldTime, oldTime);

    writeXyz("newer.xyz", [[0, 0, 0]]);
    const newerPath = path.join(tmpDir, "newer.xyz");
    const newTime = new Date("2026-02-01T00:00:00Z");
    fs.utimesSync(newerPath, newTime, newTime);

    fs.writeFileSync(path.join(tmpDir, "ignore.txt"), "not a scan");

    const res = await request(buildApp()).get("/api/rplidar/scans").set("Authorization", authHeader());
    expect(res.status).toBe(200);
    expect(res.body.map((s: { filename: string }) => s.filename)).toEqual(["newer.xyz", "older.xyz"]);
    expect(res.body[0].sizeBytes).toBeGreaterThan(0);
  });
});

describe("POST /api/rplidar/upload", () => {
  it("401s without a bearer token", async () => {
    const res = await request(buildApp()).post("/api/rplidar/upload").send({ FileName: "a.xyz", FileBase64: "MCAwIDA=" });
    expect(res.status).toBe(401);
  });

  it("rejects a missing file", async () => {
    const res = await request(buildApp()).post("/api/rplidar/upload").set("Authorization", authHeader()).send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "No file provided" });
  });

  it("rejects a non-.xyz filename", async () => {
    const res = await request(buildApp())
      .post("/api/rplidar/upload")
      .set("Authorization", authHeader())
      .send({ FileName: "scan.txt", FileBase64: "MCAwIDA=" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Only .xyz files are supported" });
  });

  it("rejects a path-traversal file name instead of writing outside the scan directory", async () => {
    const res = await request(buildApp())
      .post("/api/rplidar/upload")
      .set("Authorization", authHeader())
      .send({ FileName: "../../evil.xyz", FileBase64: "MCAwIDA=" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid file name" });
  });

  it("saves the decoded file to the scan directory and returns its parsed meta", async () => {
    const content = buildFixturePoints()
      .map(([x, y, z]) => `${x} ${y} ${z}`)
      .join("\n");
    const base64 = Buffer.from(content, "utf-8").toString("base64");

    const res = await request(buildApp())
      .post("/api/rplidar/upload")
      .set("Authorization", authHeader())
      .send({ FileName: "uploaded.xyz", FileBase64: base64 });

    expect(res.status).toBe(200);
    expect(res.body.filename).toBe("uploaded.xyz");
    expect(res.body.clusterCount).toBe(1);
    expect(res.body.meta.TotalPoints).toBe(41);

    const savedPath = path.join(tmpDir, "uploaded.xyz");
    expect(fs.existsSync(savedPath)).toBe(true);
    expect(fs.readFileSync(savedPath, "utf-8")).toBe(content);
  });

  it("accepts a data: URL for FileBase64", async () => {
    const base64 = Buffer.from("0 0 -5.0", "utf-8").toString("base64");
    const res = await request(buildApp())
      .post("/api/rplidar/upload")
      .set("Authorization", authHeader())
      .send({ FileName: "single.xyz", FileBase64: `data:text/plain;base64,${base64}` });

    expect(res.status).toBe(200);
    expect(res.body.meta.TotalPoints).toBe(1);
  });
});

describe("GET /api/rplidar/from-scan", () => {
  afterEach(async () => {
    // The Visualizer session is shared, module-level state (see visualizerSessionService.ts) -
    // reset it after every test in this block so it can't leak into the next test/file.
    await visualizerSessionService.clearPoints();
  });

  it("401s without a bearer token", async () => {
    const res = await request(buildApp()).get("/api/rplidar/from-scan");
    expect(res.status).toBe(401);
  });

  it("404s when no Visualizer session point cloud is loaded", async () => {
    const res = await request(buildApp()).get("/api/rplidar/from-scan").set("Authorization", authHeader());
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No point cloud loaded. Upload a scan or load a room in the 3D view first." });
  });

  it("classifies the current Visualizer session point cloud once one is loaded", async () => {
    // Seeds the shared in-memory session directly - visualizerSessionService's module-level state
    // is the same singleton the /from-scan wiring in rplidar.routes.ts reads (see
    // visualizerSessionService.ts / visualizer.routes.ts). LidarPoint3D X/Y/Z are centimeters
    // (see models/visualizer.ts); rplidarService.parseFromPointCloud converts to meters before
    // classifying, so the fixture's meter coordinates are scaled up by 100 here.
    const points = buildFixturePoints().map(([x, y, z]) => ({
      X: x * 100,
      Y: y * 100,
      Z: z * 100,
      Intensity: 1,
      Classification: 0,
    }));
    await visualizerSessionService.replacePoints(points);

    const res = await request(buildApp()).get("/api/rplidar/from-scan").set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body.clusters).toEqual([EXPECTED_CLUSTER]);
    expect(res.body.meta.TotalPoints).toBe(41);
  });

  it("accepts maxFloorPoints/maxCeilingPoints query params, same as GET /scans/:filename", async () => {
    const points = buildFixturePoints().map(([x, y, z]) => ({
      X: x * 100,
      Y: y * 100,
      Z: z * 100,
      Intensity: 1,
      Classification: 0,
    }));
    await visualizerSessionService.replacePoints(points);

    const res = await request(buildApp())
      .get("/api/rplidar/from-scan?maxFloorPoints=3&maxCeilingPoints=2")
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body.floor).toHaveLength(3);
    expect(res.body.ceiling).toHaveLength(2);
  });
});

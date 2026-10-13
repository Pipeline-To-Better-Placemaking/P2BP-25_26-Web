import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createTestDb } from "../test/db.js";
import { setDbForTesting } from "../db/client.js";
import { visualizerRouter } from "./visualizer.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { createUserToken } from "../services/tokenService.js";
import * as sessionService from "../services/visualizerSessionService.js";
import type { ScannerPoint } from "../models/visualizer.js";

/**
 * Not wired into app.ts yet (a later migration/consolidation step mounts it - see
 * visualizer.routes.ts's file header for the intended `/api/visualizer` mount point), so this
 * builds a minimal app around the router directly, same pattern rplidar.routes.test.ts/
 * fusion.routes.test.ts use.
 *
 * visualizerSessionService persists its session in one shared Postgres row (PGlite here) - so
 * `beforeEach` resets it for isolation.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/visualizer", visualizerRouter);
  app.use(errorHandler);
  return app;
}

function authHeader(userId = "user-1"): string {
  const { token } = createUserToken({ Id: userId, Email: "a@b.com", Role: "User" } as never);
  return `Bearer ${token}`;
}

/**
 * A square-plus-elevated-center point cloud: 4 flat corners of a 10x10 square (Z=0) plus one
 * raised center point. This exact shape is used by visualizerMeshService.test.ts's
 * smoothMeshLaplacian/createWatertightMesh coverage as a case that reliably survives alpha-shape
 * edge-length filtering and Delaunay-triangulates into a non-empty mesh (the center point
 * connects to all 4 corners, fanning into 4 triangles) - reused here so upload/mesh-generation
 * route tests aren't guessing at mesh-algorithm internals.
 */
function squareFixturePoints(): ScannerPoint[] {
  return [
    { X: 0, Y: 0, Z: 0 },
    { X: 10, Y: 0, Z: 0 },
    { X: 10, Y: 10, Z: 0 },
    { X: 0, Y: 10, Z: 0 },
    { X: 5, Y: 5, Z: 1 },
  ];
}

function squareFixtureObj(): string {
  return ["v 0 0 0", "v 10 0 0", "v 10 10 0", "v 0 10 0", "v 5 5 1", "f 1 2 3", "f 1 3 4", ""].join("\n");
}

function squareFixtureXyz(): string {
  return ["0 0 0", "10 0 0", "10 10 0", "0 10 0", "5 5 1", ""].join("\n");
}

function squareFixturePly(): string {
  return [
    "ply",
    "format ascii 1.0",
    "element vertex 5",
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "end_header",
    "0 0 0 200 200 200",
    "0.1 0 0 200 200 200",
    "0.1 0.1 0 200 200 200",
    "0 0.1 0 200 200 200",
    "0.05 0.05 0.01 200 200 200",
    "",
  ].join("\n");
}

beforeAll(async () => {
  await createTestDb();
});
afterAll(() => setDbForTesting(null));

beforeEach(async () => {
  await sessionService.clearPoints();
});

describe("GET /api/visualizer/points", () => {
  it("401s without a bearer token", async () => {
    const res = await request(buildApp()).get("/api/visualizer/points");
    expect(res.status).toBe(401);
  });

  it("returns an empty array when no point cloud is loaded", async () => {
    const res = await request(buildApp()).get("/api/visualizer/points").set("Authorization", authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /api/visualizer/points-meta", () => {
  it("returns PointCount 0 on an empty session", async () => {
    const res = await request(buildApp()).get("/api/visualizer/points-meta").set("Authorization", authHeader());
    expect(res.status).toBe(200);
    expect(res.body.PointCount).toBe(0);
    expect(typeof res.body.Revision).toBe("number");
  });
});

describe("POST /api/visualizer/scanner/upload", () => {
  it("401s without a bearer token", async () => {
    const res = await request(buildApp()).post("/api/visualizer/scanner/upload").send({ Points: [] });
    expect(res.status).toBe(401);
  });

  it("rejects an empty points array with a plain-string body", async () => {
    const res = await request(buildApp())
      .post("/api/visualizer/scanner/upload")
      .set("Authorization", authHeader())
      .send({ Points: [] });
    expect(res.status).toBe(400);
    expect(res.body).toBe("No points provided");
  });
});

describe("POST /api/visualizer/upload/obj", () => {
  it("rejects a missing file", async () => {
    const res = await request(buildApp()).post("/api/visualizer/upload/obj").set("Authorization", authHeader()).send({});
    expect(res.status).toBe(400);
    expect(res.body).toBe("No file uploaded");
  });

  it("rejects a non-.obj filename", async () => {
    const res = await request(buildApp())
      .post("/api/visualizer/upload/obj")
      .set("Authorization", authHeader())
      .send({ FileName: "model.txt", FileBase64: Buffer.from("v 0 0 0").toString("base64") });
    expect(res.status).toBe(400);
    expect(res.body).toBe("File must be an OBJ file");
  });

  it("parses an uploaded OBJ file into the session point cloud and mesh, and echoes a generated fileName", async () => {
    const base64 = Buffer.from(squareFixtureObj(), "utf-8").toString("base64");

    const res = await request(buildApp())
      .post("/api/visualizer/upload/obj")
      .set("Authorization", authHeader())
      .send({ FileName: "room.obj", FileBase64: base64 });

    expect(res.status).toBe(200);
    expect(res.body.vertexCount).toBe(5);
    expect(res.body.faceCount).toBe(2);
    expect(res.body.pointCloudCount).toBe(5);
    expect(res.body.fileName).toMatch(/_room\.obj$/);
  });
});

describe("POST /api/visualizer/upload/xyz", () => {
  it("rejects when no files are provided", async () => {
    const res = await request(buildApp()).post("/api/visualizer/upload/xyz").set("Authorization", authHeader()).send({});
    expect(res.status).toBe(400);
    expect(res.body).toBe("At least one .xyz file must be uploaded");
  });

  it("rejects two files whose combined parse yields no valid points", async () => {
    const base64 = Buffer.from("not a valid xyz line\n", "utf-8").toString("base64");
    const res = await request(buildApp())
      .post("/api/visualizer/upload/xyz")
      .set("Authorization", authHeader())
      .send({ FileNameA: "empty.xyz", FileBase64A: base64 });
    expect(res.status).toBe(400);
    expect(res.body).toBe("No valid points found in .xyz files");
  });

  it("parses a single uploaded .xyz file into the session", async () => {
    const base64 = Buffer.from(squareFixtureXyz(), "utf-8").toString("base64");

    const res = await request(buildApp())
      .post("/api/visualizer/upload/xyz?sensorId=test-sensor")
      .set("Authorization", authHeader())
      .send({ FileNameA: "scan.xyz", FileBase64A: base64, Units: "m" });

    expect(res.status).toBe(200);
    expect(res.body.pointCount).toBe(5);
    expect(res.body.message).toBe("Point cloud loaded from .xyz files.");

    const pointsRes = await request(buildApp()).get("/api/visualizer/points").set("Authorization", authHeader());
    expect(pointsRes.body).toHaveLength(5);
    expect(pointsRes.body[0].SensorId).toBe("test-sensor");
  });
});

describe("POST /api/visualizer/upload/ply", () => {
  it("rejects a missing file", async () => {
    const res = await request(buildApp()).post("/api/visualizer/upload/ply").set("Authorization", authHeader()).send({});
    expect(res.status).toBe(400);
    expect(res.body).toBe("No file uploaded");
  });

  it("rejects a non-.ply filename", async () => {
    const res = await request(buildApp())
      .post("/api/visualizer/upload/ply")
      .set("Authorization", authHeader())
      .send({ FileName: "scan.xyz", FileBase64: Buffer.from("ply").toString("base64") });
    expect(res.status).toBe(400);
    expect(res.body).toBe("File must be a PLY file");
  });

  it("parses an ASCII PLY file into the session", async () => {
    const base64 = Buffer.from(squareFixturePly(), "utf-8").toString("base64");

    const res = await request(buildApp())
      .post("/api/visualizer/upload/ply")
      .set("Authorization", authHeader())
      .send({ FileName: "scan.ply", FileBase64: base64 });

    expect(res.status).toBe(200);
    expect(res.body.pointCount).toBe(5);
    expect(res.body.message).toBe("Point cloud loaded from PLY file.");
  });
});

describe("POST /api/visualizer/geometry/mesh", () => {
  it("400s with a plain-text message when no points are loaded", async () => {
    const res = await request(buildApp()).post("/api/visualizer/geometry/mesh").set("Authorization", authHeader()).send({});
    expect(res.status).toBe(400);
    expect(res.text).toBe("No points available to generate mesh");
  });

  it("generates a legacy mesh via UseLegacy/ForceRegenerate", async () => {
    const app = buildApp();
    const auth = authHeader();
    await request(app)
      .post("/api/visualizer/scanner/upload")
      .set("Authorization", auth)
      .send({ Points: squareFixturePoints(), ConvertFromMillimeters: false });

    const res = await request(app)
      .post("/api/visualizer/geometry/mesh")
      .set("Authorization", auth)
      .send({ UseLegacy: true, ForceRegenerate: true });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toContain("v ");
    expect(res.text).toContain("f ");
  });
});

describe("export/* endpoints on an empty session", () => {
  it("export/obj and export/csv succeed with header-only output (no emptiness guard)", async () => {
    const auth = authHeader();
    const app = buildApp();

    const objRes = await request(app).get("/api/visualizer/export/obj").set("Authorization", auth);
    expect(objRes.status).toBe(200);
    expect(objRes.text).toBe("# Point Cloud OBJ Export\n");

    const csvRes = await request(app).get("/api/visualizer/export/csv").set("Authorization", auth);
    expect(csvRes.status).toBe(200);
    expect(csvRes.text).toBe("X,Y,Z,Intensity,Classification,Color\n");
  });

  it.each(["xyz", "xyz-rgb", "txt", "pts", "ply"])("export/%s 400s with 'No point cloud loaded.'", async (format) => {
    const res = await request(buildApp()).get(`/api/visualizer/export/${format}`).set("Authorization", authHeader());
    expect(res.status).toBe(400);
    expect(res.body).toBe("No point cloud loaded.");
  });

  it("export/geometry/json succeeds with the empty-room geometry", async () => {
    const res = await request(buildApp()).get("/api/visualizer/export/geometry/json").set("Authorization", authHeader());
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(JSON.parse(res.text)).toEqual({ Name: "Empty Room", Width: 0, Height: 0, Depth: 0, Walls: [], Objects: [] });
  });
});

describe("full flow: scanner/upload -> points -> points-meta -> geometry -> mesh -> export -> delete", () => {
  it("carries session state across the whole request sequence", async () => {
    const app = buildApp();
    const auth = authHeader();

    const metaBefore = await request(app).get("/api/visualizer/points-meta").set("Authorization", auth);
    const revisionBefore = metaBefore.body.Revision as number;

    const uploadRes = await request(app)
      .post("/api/visualizer/scanner/upload?projectId=proj-1&projectName=Test+Project")
      .set("Authorization", auth)
      .send({ Points: squareFixturePoints(), ConvertFromMillimeters: false });

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.pointCount).toBe(5);
    expect(uploadRes.body.meshGenerated).toBe(true);
    expect(uploadRes.body.meshFaceCount).toBeGreaterThan(0);
    expect(uploadRes.body.message).toBe("Point cloud uploaded successfully.");

    const pointsRes = await request(app).get("/api/visualizer/points").set("Authorization", auth);
    expect(pointsRes.status).toBe(200);
    expect(pointsRes.body).toHaveLength(5);
    expect(pointsRes.body[0]).toMatchObject({ X: 0, Y: 0, Z: 0 });

    const metaAfter = await request(app).get("/api/visualizer/points-meta").set("Authorization", auth);
    expect(metaAfter.body.PointCount).toBe(5);
    expect(metaAfter.body.Revision).toBe(revisionBefore + 1);

    const geomRes = await request(app).get("/api/visualizer/geometry/room").set("Authorization", auth);
    expect(geomRes.status).toBe(200);
    expect(geomRes.body).toMatchObject({ Name: "Calculated Room", Width: 10, Depth: 10 });

    // No body -> forceRegenerate/useLegacy both default false -> returns the mesh the upload
    // itself already opportunistically generated, straight from cache (no regeneration).
    const meshRes = await request(app).post("/api/visualizer/geometry/mesh").set("Authorization", auth).send({});
    expect(meshRes.status).toBe(200);
    expect(meshRes.headers["content-type"]).toMatch(/text\/plain/);
    expect(meshRes.text).toContain("v ");
    expect(meshRes.text).toContain("f ");

    const exportXyzRes = await request(app).get("/api/visualizer/export/xyz").set("Authorization", auth);
    expect(exportXyzRes.status).toBe(200);
    expect(exportXyzRes.text.trim().split("\n")).toHaveLength(5);

    const exportGeoJsonRes = await request(app).get("/api/visualizer/export/geometry/json").set("Authorization", auth);
    expect(exportGeoJsonRes.status).toBe(200);
    expect(JSON.parse(exportGeoJsonRes.text).Width).toBe(10);

    const deleteRes = await request(app).delete("/api/visualizer/points").set("Authorization", auth);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toEqual({ message: "Point cloud cleared." });

    const pointsAfterDelete = await request(app).get("/api/visualizer/points").set("Authorization", auth);
    expect(pointsAfterDelete.body).toEqual([]);

    const metaAfterDelete = await request(app).get("/api/visualizer/points-meta").set("Authorization", auth);
    expect(metaAfterDelete.body.Revision).toBe(revisionBefore + 2);

    const exportXyzAfterDelete = await request(app).get("/api/visualizer/export/xyz").set("Authorization", auth);
    expect(exportXyzAfterDelete.status).toBe(400);
    expect(exportXyzAfterDelete.body).toBe("No point cloud loaded.");
  });
});

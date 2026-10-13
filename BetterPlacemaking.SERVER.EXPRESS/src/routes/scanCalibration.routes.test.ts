import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";

import { eq } from "drizzle-orm";
import { createTestDb } from "../test/db.js";
import { setDbForTesting, type Db } from "../db/client.js";
import { projects, scanCalibrationRecords, scans } from "../db/schema/index.js";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

async function storedRecord(id: string) {
  const [r] = await db.select().from(scanCalibrationRecords).where(eq(scanCalibrationRecords.id, id));
  return r;
}

const { scanCalibrationRouter } = await import("./scanCalibration.routes.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const scanCalibrationService = await import("../services/scanCalibrationService.js");
const { bindCombineScansRequest } = await import("../models/scanCalibration.js");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "35mb" }));
  app.use("/api/scan-calibration", scanCalibrationRouter);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

// Temp .xyz fixtures, cleaned up at the end of the file.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bp-scancal-test-"));

function writeXyz(name: string, contents: string): string {
  const p = path.join(tempRoot, name);
  fs.writeFileSync(p, contents);
  return p;
}

async function seedScan(projectId: string, deviceId: string, scanId: string, objUrl: string | null): Promise<void> {
  await db.insert(projects).values({ id: projectId, title: projectId }).onConflictDoNothing();
  await db.insert(scans).values({ id: scanId, projectId, deviceId, status: "complete", objUrl });
}

afterAll(() => {
  setDbForTesting(null);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Numeric regression tests. These are the point of this file: they pin the
// actual transform math against hand-computed values, not just HTTP status
// codes. Ported from ScanCombine/CombineCloudsService.Manipulate.
// ---------------------------------------------------------------------------
describe("manipulatePoints (CombineCloudsService.Manipulate)", () => {
  it("rotates 90 degrees about the origin then translates", () => {
    // (1, 0) rotated +90 deg -> (0, 1), then translated by (10, 20) -> (10, 21).
    const out = scanCalibrationService.manipulatePoints([{ X: 1, Y: 0, Z: 5 }], 10, 20, 90);

    expect(out[0].X).toBeCloseTo(10, 12);
    expect(out[0].Y).toBeCloseTo(21, 12);
    // Z is explicitly untouched by the source.
    expect(out[0].Z).toBe(5);
  });

  it("rotates 180 degrees with no translation", () => {
    // (3, 4) has r = 5; rotating 180 deg gives (-3, -4).
    const out = scanCalibrationService.manipulatePoints([{ X: 3, Y: 4, Z: 0 }], 0, 0, 180);

    expect(out[0].X).toBeCloseTo(-3, 12);
    expect(out[0].Y).toBeCloseTo(-4, 12);
  });

  it("preserves radius from the origin under pure rotation (r = sqrt(x^2+y^2), Z excluded)", () => {
    // XyzPoint.Distance() deliberately omits Z, so a large Z must not affect the radius.
    const out = scanCalibrationService.manipulatePoints([{ X: 3, Y: 4, Z: 1000 }], 0, 0, 37);
    const r = Math.sqrt(out[0].X * out[0].X + out[0].Y * out[0].Y);

    expect(r).toBeCloseTo(5, 12);
  });

  it("applies theta=0 as a pure translation", () => {
    const out = scanCalibrationService.manipulatePoints([{ X: 2, Y: -7, Z: 1 }], -1.5, 0.25, 0);

    expect(out[0].X).toBeCloseTo(0.5, 12);
    expect(out[0].Y).toBeCloseTo(-6.75, 12);
  });
});

describe("combineClouds (CombineCloudsService.CombineClouds)", () => {
  it("concatenates both transformed clouds in input order", async () => {
    const a = writeXyz("a.xyz", "1 0 0\n0 1 0\n");
    const b = writeXyz("b.xyz", "5 5 2\n");

    const result = await scanCalibrationService.combineClouds(
      [
        { XyzFilePath: a, XTranslation: 0, YTranslation: 0, Theta: 0 },
        { XyzFilePath: b, XTranslation: 1, YTranslation: 2, Theta: 0 },
      ],
      tempRoot,
      "unit-test",
    );

    const lines = fs.readFileSync(result.OutputFilePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);

    // NOTE: values are compared numerically, not as exact strings. Even at theta = 0 the
    // source's polar round-trip (atan2 -> +0 -> cos/sin) does not return a coordinate
    // bit-identical to its input: (0, 1) comes back as (6.123233995736766e-17, 1),
    // because cos(atan2(1, 0)) is cos(pi/2), which is not exactly 0 in IEEE-754. The C#
    // does the identical round-trip and produces the identical double, so this is
    // faithful - but it means "no transform" is not a no-op on the data.
    const parsed = lines.map((l) => l.split(" ").map(Number));
    expect(parsed[0][0]).toBeCloseTo(1, 12);
    expect(parsed[0][1]).toBeCloseTo(0, 12);
    expect(parsed[1][0]).toBeCloseTo(0, 12);
    expect(parsed[1][1]).toBeCloseTo(1, 12);
    expect(parsed[2][0]).toBeCloseTo(6, 12);
    expect(parsed[2][1]).toBeCloseTo(7, 12);
    expect(parsed[2][2]).toBe(2);
    expect(result.OutputFileName.startsWith("unit-test_")).toBe(true);
    expect(result.OutputFileName.endsWith(".xyz")).toBe(true);
  });

  it("rejects fewer than two inputs, matching the source's ArgumentException", async () => {
    const a = writeXyz("solo.xyz", "1 1 1\n");
    await expect(
      scanCalibrationService.combineClouds([{ XyzFilePath: a, XTranslation: 0, YTranslation: 0, Theta: 0 }], tempRoot, null),
    ).rejects.toThrow(/At least two scans/);
  });

  it("falls back to the 'calibrationScan' base name when outputName is blank", async () => {
    const a = writeXyz("c.xyz", "1 1 1\n");
    const b = writeXyz("d.xyz", "2 2 2\n");

    const result = await scanCalibrationService.combineClouds(
      [
        { XyzFilePath: a, XTranslation: 0, YTranslation: 0, Theta: 0 },
        { XyzFilePath: b, XTranslation: 0, YTranslation: 0, Theta: 0 },
      ],
      tempRoot,
      "   ",
    );

    expect(result.OutputFileName.startsWith("calibrationScan_")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Model binding. Pins the deliberately-faithful reproduction of ASP.NET's
// binding rules, including the two client fields that do NOT bind on the old
// server. If someone later decides to fix that, these tests are what they
// should have to consciously change.
// ---------------------------------------------------------------------------
describe("bindCombineScansRequest (ASP.NET model-binding fidelity)", () => {
  it("binds the exact payload the Angular client sends", () => {
    const bound = bindCombineScansRequest({
      output_name: "my-scan",
      scalar_mm_per_pixel: 12.5,
      items: [
        { scanId: "s1", x_translation: 0, y_translation: 0, Theta: 0 },
        { scanId: "s2", x_translation: 40, y_translation: -10, Theta: 90 },
      ],
    });

    // Binds: explicit [JsonPropertyName].
    expect(bound.ScalarMmPerPixel).toBe(12.5);
    // Binds: case-insensitive match on "items" / "scanId" / "Theta".
    expect(bound.Items).toHaveLength(2);
    expect(bound.Items[1].ScanId).toBe("s2");
    expect(bound.Items[1].Theta).toBe(90);

    // Does NOT bind: an underscore is not a case difference. Reproduces the old
    // server's behaviour exactly - translations are silently dropped to 0.
    expect(bound.OutputName).toBe("calibrationScan");
    expect(bound.Items[1].XTranslation).toBe(0);
    expect(bound.Items[1].YTranslation).toBe(0);
  });

  it("binds PascalCase and camelCase spellings of the translations", () => {
    const bound = bindCombineScansRequest({
      OutputName: "explicit",
      Items: [{ ScanId: "s1", XTranslation: 3, YTranslation: 4, Theta: 45 }],
    });

    expect(bound.OutputName).toBe("explicit");
    expect(bound.Items[0].XTranslation).toBe(3);
    expect(bound.Items[0].YTranslation).toBe(4);
  });

  it("never yields NaN-producing undefined for a double member", () => {
    const bound = bindCombineScansRequest({ items: [{ scanId: "s1" }] });

    expect(bound.Items[0].XTranslation).toBe(0);
    expect(bound.Items[0].YTranslation).toBe(0);
    expect(bound.Items[0].Theta).toBe(0);
    expect(bound.ScalarMmPerPixel).toBeNull();
  });

  it("tolerates a missing or non-array Items", () => {
    expect(bindCombineScansRequest({}).Items).toEqual([]);
    expect(bindCombineScansRequest({ items: "nope" }).Items).toEqual([]);
    expect(bindCombineScansRequest(undefined).Items).toEqual([]);
  });
});

describe("renderPreviewPng (Plotter.Render)", () => {
  it("emits a valid PNG of the expected canvas size", () => {
    const png = scanCalibrationService.renderPreviewPng([{ x: 1, y: 1 }], 2);

    // PNG signature.
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR width/height at bytes 16..23 - worldPixels 1280 + padding 20 * 2 = 1320.
    expect(png.readUInt32BE(16)).toBe(1320);
    expect(png.readUInt32BE(20)).toBe(1320);
    // Bit depth 8, colour type 6 (RGBA).
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
    // The IEND chunk is the final 12 bytes: 4 length + 4 type + 4 CRC.
    expect(png.subarray(png.length - 12).toString("ascii", 4, 8)).toBe("IEND");
  });

  it("rejects a non-positive maxDistance, matching the source's guard", () => {
    expect(() => scanCalibrationService.renderPreviewPng([{ x: 0, y: 0 }], 0)).toThrow(/maxDistance must be positive/);
  });
});

// ---------------------------------------------------------------------------
// HTTP surface.
// ---------------------------------------------------------------------------
describe("GET /api/scan-calibration/:projectId/:deviceId/:scanId/preview", () => {
  it("returns a PNG for a scan whose ObjUrl is a local .xyz file", async () => {
    const xyz = writeXyz("preview.xyz", "1 0 0\n0 1 0\n-1 0 0\n");
    await seedScan("p1", "d1", "preview-ok", xyz);

    const res = await request(app).get("/api/scan-calibration/p1/d1/preview-ok/preview");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });

  it("returns 500 (not 404) for a missing scan, matching Problem(ex.Message)", async () => {
    const res = await request(app).get("/api/scan-calibration/p1/d1/nope/preview");

    expect(res.status).toBe(500);
    expect(res.body.Message).toMatch(/Scan not found/);
  });

  it("returns 500 when every point is filtered out by the Z threshold", async () => {
    // Default threshold is -2.75 and points with z <= threshold are dropped.
    const xyz = writeXyz("all-filtered.xyz", "1 1 -10\n2 2 -99\n");
    await seedScan("p1", "d1", "filtered", xyz);

    const res = await request(app).get("/api/scan-calibration/p1/d1/filtered/preview");

    expect(res.status).toBe(500);
    expect(res.body.Message).toMatch(/No valid XY points/);
  });
});

describe("POST /api/scan-calibration/:projectId/:deviceId/upload-xyz", () => {
  it("stores the file and writes a completed uploaded-calibration scan doc", async () => {
    const res = await request(app)
      .post("/api/scan-calibration/p1/d1/upload-xyz")
      .send({ FileBase64: Buffer.from("1 2 3\n").toString("base64"), FileName: "room.xyz" });

    expect(res.status).toBe(200);
    expect(res.body.Status).toBe("complete");
    expect(res.body.OriginalFileName).toBe("room.xyz");
    expect(res.body.Id).toMatch(/^[0-9a-f]{32}$/);

    const stored = await storedRecord(res.body.Id);
    expect(stored?.isUploadedCalibrationScan).toBe(true);
    expect(stored?.objUrl).toBe(res.body.ObjUrl);
    expect(fs.readFileSync(res.body.ObjUrl as string, "utf8")).toBe("1 2 3\n");

    fs.rmSync(res.body.ObjUrl as string, { force: true });
  });

  it("rejects a request with no file", async () => {
    const res = await request(app).post("/api/scan-calibration/p1/d1/upload-xyz").send({ FileName: "room.xyz" });

    expect(res.status).toBe(400);
    expect(res.text).toBe("No file uploaded.");
  });

  it("rejects a non-.xyz file name", async () => {
    const res = await request(app)
      .post("/api/scan-calibration/p1/d1/upload-xyz")
      .send({ FileBase64: Buffer.from("x").toString("base64"), FileName: "room.ply" });

    expect(res.status).toBe(400);
    expect(res.text).toBe("Only .xyz files are allowed.");
  });
});

describe("GET /api/scan-calibration/:projectId/:deviceId/:scanId/download", () => {
  it("streams the resolved .xyz file as an attachment", async () => {
    const xyz = writeXyz("download.xyz", "7 8 9\n");
    await seedScan("p1", "d1", "dl", xyz);

    // responseType("blob") makes superagent buffer the octet-stream body instead of
    // leaving res.text undefined for a non-text content type.
    const res = await request(app).get("/api/scan-calibration/p1/d1/dl/download").responseType("blob");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("download.xyz");
    expect(Buffer.from(res.body as Buffer).toString("utf8")).toBe("7 8 9\n");
  });

  it("returns 500 when the scan document has no ObjUrl", async () => {
    await seedScan("p1", "d1", "no-url", null);

    const res = await request(app).get("/api/scan-calibration/p1/d1/no-url/download");

    expect(res.status).toBe(500);
    expect(res.body.Message).toMatch(/does not have an ObjUrl/);
  });
});

describe("POST /api/scan-calibration/:projectId/:deviceId/combine", () => {
  it("combines two scans and writes a combined-calibration scan doc", async () => {
    const a = writeXyz("combine-a.xyz", "1 0 0\n");
    const b = writeXyz("combine-b.xyz", "0 1 0\n");
    await seedScan("p1", "d1", "ca", a);
    await seedScan("p1", "d1", "cb", b);

    const res = await request(app)
      .post("/api/scan-calibration/p1/d1/combine")
      .send({
        OutputName: "combined",
        scalar_mm_per_pixel: 3.5,
        Items: [
          { ScanId: "ca", XTranslation: 0, YTranslation: 0, Theta: 0 },
          { ScanId: "cb", XTranslation: 0, YTranslation: 0, Theta: 0 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.IsCombinedCalibrationScan).toBe(true);

    const stored = await storedRecord(res.body.Id);
    expect(stored?.sourceScanIds).toEqual(["ca", "cb"]);
    expect(stored?.scalarMmPerPixel).toBe(3.5);

    // Compared numerically for the same IEEE-754 polar round-trip reason as above.
    const contents = fs
      .readFileSync(res.body.ObjUrl as string, "utf8")
      .trim()
      .split("\n")
      .map((l) => l.split(" ").map(Number));
    expect(contents).toHaveLength(2);
    expect(contents[0][0]).toBeCloseTo(1, 12);
    expect(contents[0][1]).toBeCloseTo(0, 12);
    expect(contents[1][0]).toBeCloseTo(0, 12);
    expect(contents[1][1]).toBeCloseTo(1, 12);

    fs.rmSync(res.body.ObjUrl as string, { force: true });
  });

  it("rejects fewer than two items", async () => {
    const res = await request(app)
      .post("/api/scan-calibration/p1/d1/combine")
      .send({ Items: [{ ScanId: "ca", XTranslation: 0, YTranslation: 0, Theta: 0 }] });

    expect(res.status).toBe(400);
    expect(res.text).toBe("At least two scans are required.");
  });

  it("returns 500 when one of the referenced scans does not exist", async () => {
    const a = writeXyz("combine-c.xyz", "1 0 0\n");
    await seedScan("p1", "d1", "cc", a);

    const res = await request(app)
      .post("/api/scan-calibration/p1/d1/combine")
      .send({
        Items: [
          { ScanId: "cc", XTranslation: 0, YTranslation: 0, Theta: 0 },
          { ScanId: "missing", XTranslation: 0, YTranslation: 0, Theta: 0 },
        ],
      });

    expect(res.status).toBe(500);
    expect(res.body.Message).toMatch(/Scan not found/);
  });
});

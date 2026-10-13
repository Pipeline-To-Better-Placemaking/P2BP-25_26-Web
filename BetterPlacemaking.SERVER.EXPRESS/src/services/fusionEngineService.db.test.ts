import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../test/db.js";
import { createFakeStorage } from "../test/fakeStorage.js";
import { cameraIntrinsics, lockedHomographies } from "../db/schema/index.js";
import { loadHomographies, loadIntrinsics, runFusionEngine } from "./fusionEngineService.js";
import type { Db } from "../db/client.js";

const H = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const K = [800, 0, 320, 0, 800, 240, 0, 0, 1];

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("loadHomographies", () => {
  it("loads active cameras by stored mac or id suffix and skips unparseable rows", async () => {
    await db.insert(lockedHomographies).values([
      { id: "dev1_AA:BB:CC:00:00:01", cameraMac: "AA:BB:CC:00:00:01", matrixFlat: H },
      { id: "dev1_aa:bb:cc:00:00:02", cameraMac: null, matrixFlat: H },
      { id: "dev1_aa:bb:cc:00:00:03", cameraMac: "aa:bb:cc:00:00:03", matrixFlat: [1, 2] },
      { id: "dev1_aa:bb:cc:00:00:09", cameraMac: "aa:bb:cc:00:00:09", matrixFlat: H },
    ]);
    const macs = new Set(["aa:bb:cc:00:00:01", "aa:bb:cc:00:00:02", "aa:bb:cc:00:00:03"]);
    const result = await loadHomographies(macs, db);
    expect([...result.keys()].sort()).toEqual(["aa:bb:cc:00:00:01", "aa:bb:cc:00:00:02"]);
    expect(result.get("aa:bb:cc:00:00:01")).toEqual({
      matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      usedUndistortedImage: false,
    });
  });
});

describe("loadIntrinsics", () => {
  it("prefers per-unit rows and falls back to the model-level row by MAC prefix", async () => {
    await db.insert(cameraIntrinsics).values([
      {
        id: "dev1_d0:3b:f4:00:00:01",
        cameraMac: "d0:3b:f4:00:00:01",
        isPerUnit: true,
        cameraMatrixFlat: K,
        distortionCoefficients: [0.1, 0.2, 0, 0, 0],
      },
      { id: "ANNKE", modelId: "ANNKE", isPerUnit: false, cameraMatrixFlat: K, distortionCoefficients: [0.3, 0, 0, 0, 0] },
    ]);
    const result = await loadIntrinsics(new Set(["d0:3b:f4:00:00:01", "d0:3b:f4:00:00:02", "11:22:33:44:55:66"]), db);
    expect(result.get("d0:3b:f4:00:00:01")?.distCoeffs[0]).toBe(0.1);
    expect(result.get("d0:3b:f4:00:00:02")?.distCoeffs[0]).toBe(0.3);
    expect(result.has("11:22:33:44:55:66")).toBe(false);
    expect(result.get("d0:3b:f4:00:00:01")?.cameraMatrix[0]).toEqual([800, 0, 320]);
  });
});

describe("runFusionEngine storage I/O", () => {
  it("fails with a clear message when the input folder is empty", async () => {
    createFakeStorage();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await runFusionEngine({ from: new Date("2025-01-01"), to: new Date("2025-01-01") });
    expect(res.success).toBe(false);
    expect(res.message).toContain("No track files found");
  });

  it("lists the input folder (skipping sub-folders) and downloads only in-range files", async () => {
    const { bucket, objects } = createFakeStorage();
    vi.spyOn(console, "error").mockImplementation(() => {});
    objects.set("vision/tracks-raw/cam1-20250101-120000.jsonl", { bytes: Buffer.from("\n") });
    objects.set("vision/tracks-raw/cam1-20250301-120000.jsonl", { bytes: Buffer.from("\n") });
    bucket.list.mockResolvedValue({
      data: [
        { name: "cam1-20250101-120000.jsonl", updated_at: "2025-01-01T12:00:00Z" },
        { name: "cam1-20250301-120000.jsonl", updated_at: "2025-03-01T12:00:00Z" },
        { name: "archive", updated_at: null },
      ],
      error: null,
    });
    await runFusionEngine({ from: new Date("2025-01-01"), to: new Date("2025-01-01") });
    expect(bucket.list).toHaveBeenCalledWith("vision/tracks-raw", { limit: 1000, offset: 0 });
    expect(bucket.download).toHaveBeenCalledTimes(1);
    expect(bucket.download).toHaveBeenCalledWith("vision/tracks-raw/cam1-20250101-120000.jsonl");
  });
});

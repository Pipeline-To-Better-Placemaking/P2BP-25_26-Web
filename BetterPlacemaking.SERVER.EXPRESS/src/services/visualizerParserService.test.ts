import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  convert2DTo3D,
  convertToLidarPoint3D,
  extractPointCloudFromObj,
  parseObjFile,
  parsePlyStream,
  parseXyzFile,
  parseXyzFiles,
} from "./visualizerParserService.js";

function writeTempXyz(name: string, content: string): string {
  const filePath = path.join(os.tmpdir(), `visualizer-parser-test-${Date.now()}-${name}`);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("parseObjFile", () => {
  const sample = [
    "# Test OBJ",
    "v 1.0 2.0 3.0",
    "v 4.5 -5.5 6.25",
    "v 0 0 0",
    "f 1 2 3",
    "f 1/1/1 2/2/2 3/3/3",
    "",
  ].join("\n");

  it("parses vertex count and exact coordinates", () => {
    const mesh = parseObjFile(sample);
    expect(mesh.Vertices).toHaveLength(3);
    expect(mesh.Vertices[0]).toEqual({ X: 1.0, Y: 2.0, Z: 3.0 });
    expect(mesh.Vertices[1]).toEqual({ X: 4.5, Y: -5.5, Z: 6.25 });
    expect(mesh.Vertices[2]).toEqual({ X: 0, Y: 0, Z: 0 });
  });

  it("parses face vertex indices as 0-based, stripping vt/vn suffixes", () => {
    const mesh = parseObjFile(sample);
    expect(mesh.Faces).toHaveLength(2);
    expect(mesh.Faces[0]).toEqual([0, 1, 2]);
    expect(mesh.Faces[1]).toEqual([0, 1, 2]);
  });

  it("never populates Normals (matches the original, which declares but never fills it)", () => {
    const mesh = parseObjFile(sample);
    expect(mesh.Normals).toEqual([]);
  });

  it("ignores blank lines and comment lines", () => {
    const mesh = parseObjFile("\n# just a comment\n\nv 1 2 3\n");
    expect(mesh.Vertices).toEqual([{ X: 1, Y: 2, Z: 3 }]);
  });

  it("ignores a face line with fewer than 3 indices", () => {
    const mesh = parseObjFile("v 1 2 3\nv 4 5 6\nf 1 2\n");
    expect(mesh.Faces).toEqual([]);
  });

  it("throws on a malformed numeric vertex token, mirroring double.Parse", () => {
    expect(() => parseObjFile("v 1.0 x 3.0\n")).toThrow();
  });
});

describe("extractPointCloudFromObj", () => {
  it("maps each vertex to a LidarPoint3D with fixed Intensity/Classification", () => {
    const points = extractPointCloudFromObj("v 1 2 3\nv 4 5 6\n");
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ X: 1, Y: 2, Z: 3, Intensity: 0.8, Classification: 0 });
    expect(points[1]).toEqual({ X: 4, Y: 5, Z: 6, Intensity: 0.8, Classification: 0 });
  });
});

describe("parsePlyStream", () => {
  const sample = [
    "ply",
    "format ascii 1.0",
    "element vertex 3",
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "end_header",
    "0.01 0.02 0.03 255 0 0",
    "0.04 0.05 0.06 0 255 0",
    "0.07 0.08 0.09 0 0 255",
    "",
  ].join("\n");

  it("parses exact vertex count and converts meters to centimeters", () => {
    const points = parsePlyStream(sample);
    expect(points).toHaveLength(3);
    expect(points[0].X).toBeCloseTo(1, 9);
    expect(points[0].Y).toBeCloseTo(2, 9);
    expect(points[0].Z).toBeCloseTo(3, 9);
    expect(points[2].X).toBeCloseTo(7, 9);
    expect(points[2].Y).toBeCloseTo(8, 9);
    expect(points[2].Z).toBeCloseTo(9, 9);
  });

  it("parses r/g/b into an uppercase hex Color string", () => {
    const points = parsePlyStream(sample);
    expect(points[0].Color).toBe("#FF0000");
    expect(points[1].Color).toBe("#00FF00");
    expect(points[2].Color).toBe("#0000FF");
  });

  it("sets fixed Intensity=1.0 and Classification=0, and passes through sensorId", () => {
    const points = parsePlyStream(sample, "sensor-a");
    expect(points[0].Intensity).toBe(1.0);
    expect(points[0].Classification).toBe(0);
    expect(points[0].SensorId).toBe("sensor-a");
  });

  it("supports r/g/b property names as a fallback for red/green/blue", () => {
    const rgbSample = [
      "ply",
      "format ascii 1.0",
      "element vertex 1",
      "property float x",
      "property float y",
      "property float z",
      "property uchar r",
      "property uchar g",
      "property uchar b",
      "end_header",
      "0.1 0.2 0.3 10 20 30",
      "",
    ].join("\n");
    const points = parsePlyStream(rgbSample);
    expect(points).toHaveLength(1);
    expect(points[0].Color).toBe("#0A141E");
  });

  it("returns an empty list when x/y/z properties are missing", () => {
    const noXyz = [
      "ply",
      "format ascii 1.0",
      "element vertex 1",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      "end_header",
      "255 0 0",
      "",
    ].join("\n");
    expect(parsePlyStream(noXyz)).toEqual([]);
  });

  it("returns an empty list when the header never sets a vertex count", () => {
    expect(parsePlyStream("ply\nformat ascii 1.0\nend_header\n")).toEqual([]);
  });

  it("downsamples via a fixed step when maxPoints is set", () => {
    const lines = ["ply", "format ascii 1.0", "element vertex 10", "property float x", "property float y", "property float z", "end_header"];
    for (let i = 0; i < 10; i++) lines.push(`${i} ${i} ${i}`);
    const content = `${lines.join("\n")}\n`;

    const points = parsePlyStream(content, null, 3);
    // step = ceil(10/3) = 4 -> indices 0, 4, 8
    expect(points).toHaveLength(3);
    expect(points.map((p) => p.X)).toEqual([0, 400, 800]);
  });
});

describe("parseXyzFile / parseXyzFiles (disk-backed)", () => {
  it("parses x y z lines (default mm units) with default gray color/intensity", async () => {
    const file = writeTempXyz("a.xyz", "10 20 30\n");
    try {
      const points = await parseXyzFile(file);
      expect(points).toHaveLength(1);
      expect(points[0].X).toBeCloseTo(1, 9); // 10mm -> 1cm
      expect(points[0].Y).toBeCloseTo(2, 9);
      expect(points[0].Z).toBeCloseTo(3, 9);
      expect(points[0].Color).toBe("#969696"); // default r=g=b=150
      expect(points[0].Intensity).toBeCloseTo(150 / 255, 9); // (150+150+150)/3/255
      expect(points[0].SensorId).toBe("rplidar");
    } finally {
      fs.unlinkSync(file);
    }
  });

  it("parses x y z intensity lines (grayscale r=g=b=intensity)", async () => {
    const file = writeTempXyz("b.xyz", "40 50 60 200\n");
    try {
      const points = await parseXyzFile(file);
      expect(points[0].Color).toBe("#C8C8C8"); // 200 = 0xC8
      expect(points[0].Intensity).toBeCloseTo(200 / 255, 9);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it("parses x y z r g b lines and honors 'm' units", async () => {
    const file = writeTempXyz("c.xyz", "0.07 0.08 0.09 10 20 30\n");
    try {
      const points = await parseXyzFile(file, "sensor-c", "m");
      expect(points[0].X).toBeCloseTo(7, 9); // 0.07m -> 7cm
      expect(points[0].Y).toBeCloseTo(8, 9);
      expect(points[0].Z).toBeCloseTo(9, 9);
      expect(points[0].Color).toBe("#0A141E");
      expect(points[0].SensorId).toBe("sensor-c");
    } finally {
      fs.unlinkSync(file);
    }
  });

  it("skips malformed lines instead of throwing", async () => {
    const file = writeTempXyz("d.xyz", "1 2 3\nnot a point\n4 5 6\n\n");
    try {
      const points = await parseXyzFile(file);
      expect(points).toHaveLength(2);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it("throws when the file does not exist", async () => {
    await expect(parseXyzFile("/no/such/file.xyz")).rejects.toThrow();
  });

  it("parseXyzFiles merges two files in order, skipping a missing second file", async () => {
    const fileA = writeTempXyz("e.xyz", "1 1 1\n");
    const fileB = writeTempXyz("f.xyz", "2 2 2\n");
    try {
      const merged = await parseXyzFiles(fileA, fileB);
      expect(merged).toHaveLength(2);
      expect(merged[0].X).toBeCloseTo(0.1, 9);
      expect(merged[1].X).toBeCloseTo(0.2, 9);

      const onlyA = await parseXyzFiles(fileA, "/no/such/file.xyz");
      expect(onlyA).toHaveLength(1);
    } finally {
      fs.unlinkSync(fileA);
      fs.unlinkSync(fileB);
    }
  });

  it("convertToLidarPoint3D converts mm to cm and computes intensity/color", async () => {
    const p = convertToLidarPoint3D(100, 200, 300, 255, 0, 0, "sensor-b");
    expect(p.X).toBeCloseTo(10, 9);
    expect(p.Y).toBeCloseTo(20, 9);
    expect(p.Z).toBeCloseTo(30, 9);
    expect(p.Intensity).toBeCloseTo(255 / 3 / 255, 9);
    expect(p.Color).toBe("#FF0000");
    expect(p.Classification).toBe(0);
    expect(p.SensorId).toBe("sensor-b");
  });

  it("convertToLidarPoint3D defaults sensorId to 'rplidar' and rgb to mid-gray", async () => {
    const p = convertToLidarPoint3D(10, 10, 10);
    expect(p.Color).toBe("#969696");
    expect(p.SensorId).toBe("rplidar");
  });
});

describe("convert2DTo3D", () => {
  it("mirrors PointCloudService.Convert2DTo3D", async () => {
    const points = convert2DTo3D([{ X: 1, Y: 2 }, { X: 3, Y: 4 }], 42);
    expect(points).toEqual([
      { X: 1, Y: 2, Z: 42, Intensity: 0.8, Classification: 0 },
      { X: 3, Y: 4, Z: 42, Intensity: 0.8, Classification: 0 },
    ]);
  });
});

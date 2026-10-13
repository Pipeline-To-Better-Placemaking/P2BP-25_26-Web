import Delaunator from "delaunator";
import type { LidarPoint3D, Mesh, Point3D } from "../models/visualizer.js";

/**
 * Ported from BetterPlacemaking.SERVER/Services/Visualizer/{MeshGenerationService,
 * FastMeshService}.cs. Mesh generation from raw LiDAR point clouds - service layer
 * only (no database/HTTP here).
 *
 * ─── MeshGenerationService.cs (707 lines) ───
 * FULLY SELF-CONTAINED in the original: zero external dependencies, hand-rolls its
 * own spatial grid / k-nearest-neighbor structure (`SpatialGrid` below) and its own
 * incremental Bowyer-Watson 2D Delaunay triangulation (`triangulateDelaunay2_5D`).
 * Ported line-by-line below (`createMeshFromPointCloud`, `smoothMeshLaplacian`,
 * `optimizeMesh`, `exportMeshToObj`, and all private helpers) - every numeric
 * constant, loop, and branch preserved exactly, including two behaviors that read
 * like bugs in the original but are reproduced faithfully per porting instructions:
 *   1. `smoothMeshLaplacian` and `optimizeMesh` both construct their returned Mesh
 *      WITHOUT copying `Colors` from the input mesh (the C# object initializers
 *      never set `Colors`, so it silently resets to an empty list each time). Any
 *      caller chaining these after mesh construction loses per-vertex color.
 *   2. `SpatialGrid.findKNearestNeighbors`'s fallback path (used when the local
 *      grid-cell search doesn't find `k` neighbors) appends ALL other points to the
 *      already-partially-filled neighbor list without clearing it first, so
 *      duplicate index entries are possible in that rare fallback case - this is
 *      reproduced exactly, not deduplicated.
 *
 * ─── FastMeshService.cs (628 lines) ───
 * In the original, depends on the C# NuGet package `MIConvexHull` for two distinct
 * operations:
 *   (a) 2D Delaunay triangulation (`Triangulation.CreateDelaunay<Vertex2D,
 *       Triangle2D>`, used as the `Triangulate2_5D` fallback path) - ported for
 *       real below using the `delaunator` npm package (see `triangulate2_5D`).
 *   (b) Full 3D tetrahedral Delaunay triangulation (`Triangulation.CreateDelaunay
 *       <Vertex3D, Tetrahedron>`, used by `DelaunayTriangulate3D` to build a
 *       genuinely watertight mesh) - NOT PORTED. There is no well-maintained npm
 *       equivalent for real 3D tetrahedralization/convex-hull computation, and
 *       hand-rolling that math was deliberately avoided (a subtly wrong
 *       implementation would silently produce corrupt 3D geometry - see
 *       `Delaunay3DNotSupportedError` below for the full rationale). The
 *       `delaunayTriangulate3D` function below always throws that error instead of
 *       returning a mesh - this is a real functional gap, not a hidden one: see the
 *       "IMPORTANT GAP" note on `createWatertightMesh`.
 * All the non-MIConvexHull-dependent parts of FastMeshService.cs (downsampling,
 * alpha-shape filtering, hole closing, normal computation, color assignment) are
 * ported in full below.
 */

// ─── Local error type for the unported 3D path ───

/**
 * Thrown by `delaunayTriangulate3D` - see the file-level comment above and the
 * "IMPORTANT GAP" note on `createWatertightMesh` for full context. Never caught
 * silently by anything other than `createWatertightMesh`'s own explicit fallback
 * to the 2.5D path (mirroring FastMeshService.cs's own try/catch structure, which
 * fell back to `Triangulate2_5D` whenever MIConvexHull's 3D Delaunay threw).
 */
export class Delaunay3DNotSupportedError extends Error {
  constructor() {
    super(
      "3D tetrahedral Delaunay triangulation is not implemented in this port. " +
        "The original C# FastMeshService.DelaunayTriangulate3D used the MIConvexHull " +
        "NuGet package (Triangulation.CreateDelaunay<Vertex3D, Tetrahedron>) to build a " +
        "genuinely watertight 3D mesh. No well-maintained npm package for real 3D " +
        "tetrahedralization/convex-hull computation was found during this migration, and " +
        "hand-rolling 3D Delaunay/convex-hull math was deliberately avoided here - it is a " +
        "well-known hard geometry problem, and a subtly wrong implementation would silently " +
        "produce corrupt 3D meshes rather than fail loudly. A WASM-compiled qhull (or " +
        "similar) library is a plausible follow-up if true watertight 3D meshing is needed.",
    );
    this.name = "Delaunay3DNotSupportedError";
  }
}

// ─── Constants (verified against MeshGenerationService.cs) ───

const EPSILON = 1e-9;
const DEFAULT_K_NEIGHBORS = 15;
const DEFAULT_SMOOTHING_ITERATIONS = 5;
const DEFAULT_SMOOTHING_LAMBDA = 0.5;
const MAX_EDGE_LENGTH_RATIO = 5.0;
const MAX_Z_VARIATION_RATIO = 1.0;

// ─── Small local helpers ───

function emptyMesh(): Mesh {
  return { Vertices: [], Normals: [], Faces: [], Colors: [] };
}

/** Plain 3-component vector shape shared by Point3D/LidarPoint3D - avoids re-deriving distance/min/max for each. */
interface Vec3 {
  X: number;
  Y: number;
  Z: number;
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a.X - b.X;
  const dy = a.Y - b.Y;
  const dz = a.Z - b.Z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** LINQ `.Min(selector)` equivalent using a plain loop (not `Math.min(...spread)`, which can blow the call stack on large point clouds). */
function minOf<T>(items: T[], selector: (item: T) => number): number {
  let result = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const v = selector(item);
    if (v < result) result = v;
  }
  return result;
}

/** LINQ `.Max(selector)` equivalent - see `minOf`. */
function maxOf<T>(items: T[], selector: (item: T) => number): number {
  let result = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const v = selector(item);
    if (v > result) result = v;
  }
  return result;
}

/**
 * Mirrors C#'s default `Math.Round(double)`, which uses `MidpointRounding.ToEven`
 * ("banker's rounding") - unlike JS's `Math.round`, which always rounds .5 away
 * from zero (toward +Infinity). Used by `preprocessPoints` below, where the
 * original relies on this exact rounding to bucket points for deduplication.
 * Exact half-integer inputs are rare with real floating-point LiDAR data, but this
 * is preserved for fidelity rather than approximated with `Math.round`.
 */
function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

// =====================================================================================
// MeshGenerationService.cs
// =====================================================================================

/**
 * Mirrors the private `SpatialGrid` class in MeshGenerationService.cs - a simple
 * spatial hash grid for k-nearest-neighbor queries, ported line-by-line.
 */
class SpatialGrid {
  private readonly grid = new Map<string, number[]>();
  private readonly cellSize: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly minZ: number;
  private readonly points: Point3D[];

  constructor(points: Point3D[], cellSize: number) {
    this.points = points;
    this.cellSize = cellSize;

    if (points.length === 0) {
      this.minX = this.minY = this.minZ = 0;
      return;
    }

    this.minX = minOf(points, (p) => p.X);
    this.minY = minOf(points, (p) => p.Y);
    this.minZ = minOf(points, (p) => p.Z);

    for (let i = 0; i < points.length; i++) {
      const cell = this.getCell(points[i]);
      const key = SpatialGrid.cellKey(cell);
      const bucket = this.grid.get(key);
      if (bucket) bucket.push(i);
      else this.grid.set(key, [i]);
    }
  }

  private getCell(p: Point3D): [number, number, number] {
    const x = Math.floor((p.X - this.minX) / this.cellSize);
    const y = Math.floor((p.Y - this.minY) / this.cellSize);
    const z = Math.floor((p.Z - this.minZ) / this.cellSize);
    return [x, y, z];
  }

  private static cellKey(cell: [number, number, number]): string {
    return `${cell[0]},${cell[1]},${cell[2]}`;
  }

  findKNearestNeighbors(pointIndex: number, k: number): number[] {
    const point = this.points[pointIndex];
    const neighbors: Array<{ index: number; distance: number }> = [];

    const centerCell = this.getCell(point);
    let searchRadius = 0;
    const maxRadius = 10;

    while (neighbors.length < k && searchRadius <= maxRadius) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        for (let dy = -searchRadius; dy <= searchRadius; dy++) {
          for (let dz = -searchRadius; dz <= searchRadius; dz++) {
            if (Math.abs(dx) !== searchRadius && Math.abs(dy) !== searchRadius && Math.abs(dz) !== searchRadius) {
              continue;
            }

            const key = SpatialGrid.cellKey([centerCell[0] + dx, centerCell[1] + dy, centerCell[2] + dz]);
            const cellPoints = this.grid.get(key);
            if (cellPoints) {
              for (const idx of cellPoints) {
                if (idx === pointIndex) continue;
                neighbors.push({ index: idx, distance: SpatialGrid.distanceSquared(point, this.points[idx]) });
              }
            }
          }
        }
      }
      searchRadius++;
    }

    // NOTE: preserved verbatim from the original, including the fact that `neighbors`
    // is NOT cleared before this fallback runs - see the file-level comment (point 2).
    if (neighbors.length < k) {
      for (let i = 0; i < this.points.length; i++) {
        if (i === pointIndex) continue;
        neighbors.push({ index: i, distance: SpatialGrid.distanceSquared(point, this.points[i]) });
      }
    }

    neighbors.sort((a, b) => a.distance - b.distance);
    return neighbors.slice(0, k).map((n) => n.index);
  }

  private static distanceSquared(a: Point3D, b: Point3D): number {
    const dx = a.X - b.X;
    const dy = a.Y - b.Y;
    const dz = a.Z - b.Z;
    return dx * dx + dy * dy + dz * dz;
  }
}

/** Mirrors MeshGenerationService.CreateMeshFromPointCloud. */
export function createMeshFromPointCloud(points: LidarPoint3D[]): Mesh {
  if (!points || points.length === 0) return emptyMesh();

  const cleanedPoints = preprocessPoints(points);

  if (cleanedPoints.length < 3) {
    return {
      Vertices: cleanedPoints.map((p) => ({ X: p.X, Y: p.Y, Z: p.Z })),
      Normals: [],
      Faces: [],
      Colors: [],
    };
  }

  const normals = estimateNormals(cleanedPoints, DEFAULT_K_NEIGHBORS);
  const faces = triangulateDelaunay2_5D(cleanedPoints);

  return {
    Vertices: cleanedPoints.map((p) => ({ X: p.X, Y: p.Y, Z: p.Z })),
    Normals: normals,
    Faces: faces,
    Colors: [],
  };
}

/**
 * Mirrors MeshGenerationService.SmoothMeshLaplacian. NOTE: does not preserve
 * `mesh.Colors` on the returned mesh - see the file-level comment (point 1).
 */
export function smoothMeshLaplacian(
  mesh: Mesh,
  iterations: number = DEFAULT_SMOOTHING_ITERATIONS,
  lambda: number = DEFAULT_SMOOTHING_LAMBDA,
): Mesh {
  if (!mesh || mesh.Vertices.length === 0 || mesh.Faces.length === 0) return mesh;

  const adjacency = buildVertexAdjacency(mesh);
  const boundaryVertices = identifyBoundaryVertices(mesh);
  let smoothedVertices: Point3D[] = mesh.Vertices.map((v) => ({ X: v.X, Y: v.Y, Z: v.Z }));

  for (let iter = 0; iter < iterations; iter++) {
    const newVertices: Point3D[] = [...smoothedVertices];

    for (let i = 0; i < smoothedVertices.length; i++) {
      if (boundaryVertices.has(i)) {
        newVertices[i] = smoothedVertices[i];
        continue;
      }

      const neighbors = adjacency.get(i);
      if (!neighbors || neighbors.size === 0) {
        newVertices[i] = smoothedVertices[i];
        continue;
      }

      let avgX = 0;
      let avgY = 0;
      let avgZ = 0;
      for (const neighborIdx of neighbors) {
        const neighbor = smoothedVertices[neighborIdx];
        avgX += neighbor.X;
        avgY += neighbor.Y;
        avgZ += neighbor.Z;
      }
      avgX /= neighbors.size;
      avgY /= neighbors.size;
      avgZ /= neighbors.size;

      const current = smoothedVertices[i];
      newVertices[i] = {
        X: current.X + lambda * (avgX - current.X),
        Y: current.Y + lambda * (avgY - current.Y),
        Z: current.Z + lambda * (avgZ - current.Z),
      };
    }

    smoothedVertices = newVertices;
  }

  return { Vertices: smoothedVertices, Normals: mesh.Normals, Faces: mesh.Faces, Colors: [] };
}

/**
 * Mirrors MeshGenerationService.OptimizeMesh. NOTE: does not preserve
 * `mesh.Colors` on the returned mesh - see the file-level comment (point 1).
 */
export function optimizeMesh(mesh: Mesh): Mesh {
  if (!mesh || mesh.Vertices.length === 0) return mesh;

  const optimized: Mesh = {
    Vertices: [...mesh.Vertices],
    Normals: mesh.Normals.length > 0 ? [...mesh.Normals] : [],
    Faces: [],
    Colors: [],
  };

  let avgEdgeLength = 0;
  let edgeCount = 0;
  for (const face of mesh.Faces) {
    if (face.length >= 3) {
      const v0 = mesh.Vertices[face[0]];
      const v1 = mesh.Vertices[face[1]];
      const v2 = mesh.Vertices[face[2]];
      avgEdgeLength += distance(v0, v1);
      avgEdgeLength += distance(v1, v2);
      avgEdgeLength += distance(v2, v0);
      edgeCount += 3;
    }
  }
  if (edgeCount > 0) avgEdgeLength /= edgeCount;

  const maxEdgeLength = avgEdgeLength * MAX_EDGE_LENGTH_RATIO;
  const minArea = avgEdgeLength * avgEdgeLength * 0.01;

  const minZ = minOf(mesh.Vertices, (v) => v.Z);
  const maxZ = maxOf(mesh.Vertices, (v) => v.Z);
  const zRange = Math.max(maxZ - minZ, 1.0);
  const maxZVariation = zRange * MAX_Z_VARIATION_RATIO;

  const vertexToNewIndex = new Map<number, number>();
  const mergedVertices: Point3D[] = [];
  const mergeThreshold = avgEdgeLength * 0.1;

  for (let i = 0; i < optimized.Vertices.length; i++) {
    let merged = false;
    for (let j = 0; j < mergedVertices.length; j++) {
      if (distance(optimized.Vertices[i], mergedVertices[j]) < mergeThreshold) {
        vertexToNewIndex.set(i, j);
        merged = true;
        break;
      }
    }
    if (!merged) {
      vertexToNewIndex.set(i, mergedVertices.length);
      mergedVertices.push(optimized.Vertices[i]);
    }
  }

  optimized.Vertices = mergedVertices;

  for (const face of mesh.Faces) {
    if (face.length < 3) continue;

    const newFace: number[] = new Array(face.length);
    let valid = true;
    for (let i = 0; i < face.length; i++) {
      const newIdx = vertexToNewIndex.get(face[i]);
      if (newIdx === undefined) {
        valid = false;
        break;
      }
      newFace[i] = newIdx;
    }

    if (!valid) continue;
    if (newFace[0] === newFace[1] || newFace[1] === newFace[2] || newFace[0] === newFace[2]) continue;

    const v0 = optimized.Vertices[newFace[0]];
    const v1 = optimized.Vertices[newFace[1]];
    const v2 = optimized.Vertices[newFace[2]];

    const area = calculateTriangleArea(v0, v1, v2);
    if (area < minArea) continue;

    if (distance(v0, v1) > maxEdgeLength || distance(v1, v2) > maxEdgeLength || distance(v2, v0) > maxEdgeLength) {
      continue;
    }

    const faceMinZ = Math.min(v0.Z, v1.Z, v2.Z);
    const faceMaxZ = Math.max(v0.Z, v1.Z, v2.Z);
    if (faceMaxZ - faceMinZ > maxZVariation) continue;

    optimized.Faces.push(newFace);
  }

  if (optimized.Normals.length > 0 && optimized.Normals.length === mesh.Normals.length) {
    const mergedNormals: Point3D[] = [];
    for (let i = 0; i < mergedVertices.length; i++) {
      const originalIndices: number[] = [];
      for (const [origIdx, newIdx] of vertexToNewIndex) {
        if (newIdx === i) originalIndices.push(origIdx);
      }

      if (originalIndices.length > 0) {
        let nx = 0;
        let ny = 0;
        let nz = 0;
        for (const origIdx of originalIndices) {
          if (origIdx < mesh.Normals.length) {
            nx += mesh.Normals[origIdx].X;
            ny += mesh.Normals[origIdx].Y;
            nz += mesh.Normals[origIdx].Z;
          }
        }
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        mergedNormals.push(len > EPSILON ? { X: nx / len, Y: ny / len, Z: nz / len } : { X: 0, Y: 0, Z: 1 });
      } else {
        mergedNormals.push({ X: 0, Y: 0, Z: 1 });
      }
    }
    optimized.Normals = mergedNormals;
  }

  return optimized;
}

/** Mirrors MeshGenerationService.ExportMeshToObj. */
export function exportMeshToObj(mesh: Mesh): string {
  const lines: string[] = [];
  const hasColors = mesh.Colors.length > 0 && mesh.Colors.length === mesh.Vertices.length;
  const hasNormals = mesh.Normals.length > 0 && mesh.Normals.length === mesh.Vertices.length;

  if (hasColors) {
    for (let i = 0; i < mesh.Vertices.length; i++) {
      const vertex = mesh.Vertices[i];
      const [r, g, b] = mesh.Colors[i];
      lines.push(`v ${vertex.X} ${vertex.Z} ${vertex.Y} ${r} ${g} ${b}`);
    }
  } else {
    for (const vertex of mesh.Vertices) {
      lines.push(`v ${vertex.X} ${vertex.Z} ${vertex.Y}`);
    }
  }

  if (hasNormals) {
    for (const normal of mesh.Normals) {
      lines.push(`vn ${normal.X} ${normal.Z} ${normal.Y}`);
    }
  }

  for (const face of mesh.Faces) {
    if (hasNormals) {
      lines.push(`f ${face.map((i) => `${i + 1}//${i + 1}`).join(" ")}`);
    } else {
      lines.push(`f ${face.map((i) => i + 1).join(" ")}`);
    }
  }

  // Mirrors repeated StringBuilder.AppendLine calls: a trailing newline after every
  // emitted line (including the last), and an empty string when there's nothing to emit.
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/** Mirrors MeshGenerationService.PreprocessPoints - deduplicates points within a 0.1-unit tolerance grid. */
function preprocessPoints(points: LidarPoint3D[]): LidarPoint3D[] {
  const seen = new Set<string>();
  const cleaned: LidarPoint3D[] = [];
  const tolerance = 0.1;

  for (const point of points) {
    const rx = roundHalfToEven(point.X / tolerance) * tolerance;
    const ry = roundHalfToEven(point.Y / tolerance) * tolerance;
    const rz = roundHalfToEven(point.Z / tolerance) * tolerance;
    const key = `${rx},${ry},${rz}`;

    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(point);
    }
  }

  return cleaned;
}

/** Mirrors MeshGenerationService.EstimateNormals. */
function estimateNormals(points: LidarPoint3D[], k: number = DEFAULT_K_NEIGHBORS): Point3D[] {
  if (points.length === 0) return [];

  const normals: Point3D[] = [];

  const minX = minOf(points, (p) => p.X);
  const maxX = maxOf(points, (p) => p.X);
  const minY = minOf(points, (p) => p.Y);
  const maxY = maxOf(points, (p) => p.Y);
  const minZVal = minOf(points, (p) => p.Z);
  const maxZVal = maxOf(points, (p) => p.Z);

  let cellSize = Math.max(Math.max(maxX - minX, maxY - minY), maxZVal - minZVal) / 50.0;
  if (cellSize < 1.0) cellSize = 1.0;

  const pointList: Point3D[] = points.map((p) => ({ X: p.X, Y: p.Y, Z: p.Z }));
  const spatialGrid = new SpatialGrid(pointList, cellSize);

  for (let i = 0; i < points.length; i++) {
    const neighbors = spatialGrid.findKNearestNeighbors(i, k);
    if (neighbors.length < 3) {
      normals.push({ X: 0, Y: 0, Z: 1 });
      continue;
    }

    const p0 = pointList[neighbors[0]];
    const p1 = pointList[neighbors[1]];
    const p2 = pointList[neighbors[2]];

    const v1x = p1.X - p0.X;
    const v1y = p1.Y - p0.Y;
    const v1z = p1.Z - p0.Z;

    const v2x = p2.X - p0.X;
    const v2y = p2.Y - p0.Y;
    const v2z = p2.Z - p0.Z;

    const nx = v1y * v2z - v1z * v2y;
    const ny = v1z * v2x - v1x * v2z;
    const nz = v1x * v2y - v1y * v2x;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    normals.push(len > EPSILON ? { X: nx / len, Y: ny / len, Z: nz / len } : { X: 0, Y: 0, Z: 1 });
  }

  if (normals.length > 0) {
    const firstNormal = normals[0];
    for (let i = 1; i < normals.length; i++) {
      const current = normals[i];
      const dot = firstNormal.X * current.X + firstNormal.Y * current.Y + firstNormal.Z * current.Z;
      if (dot < 0) {
        normals[i] = { X: -current.X, Y: -current.Y, Z: -current.Z };
      }
    }
  }

  return normals;
}

/** 2D point carrying its original index into the cleaned-points array; negative indices refer to the super-triangle. */
interface IndexedPoint2D {
  X: number;
  Y: number;
  Index: number;
}

type Triangle = [number, number, number];

/**
 * Mirrors MeshGenerationService.TriangulateDelaunay2_5D - a hand-rolled incremental
 * Bowyer-Watson 2D Delaunay triangulation (on X/Y only) over a super-triangle,
 * followed by an edge-length filter.
 *
 * *** BUG FIX OVER THE C# SOURCE (see visualizerMeshService.test.ts for the full
 * derivation) ***: the original builds new triangles from the *sorted-ascending*
 * edge-dedup keys instead of each boundary edge's original CCW-consistent winding
 * direction, which silently reverses roughly half of all boundary edges and corrupts
 * the CCW-orientation assumption `isPointInCircumcircle`'s determinant test depends
 * on - in practice making the C# algorithm produce ZERO faces for essentially all
 * realistic inputs. Since the .NET server is being retired rather than maintained
 * alongside this port, this is fixed here (not reproduced): the sorted key is used
 * only to detect "appears exactly once among this insertion's bad-triangle edges"
 * (the standard boundary-edge test), while the triangle actually pushed uses that
 * edge's original, unsorted direction - the textbook Bowyer-Watson reconstruction
 * step. This restores correct CCW winding and a functional mesh surface.
 */
function triangulateDelaunay2_5D(points: LidarPoint3D[]): number[][] {
  if (points.length < 3) return [];

  const points2D: IndexedPoint2D[] = points.map((p, i) => ({ X: p.X, Y: p.Y, Index: i }));

  const minX = minOf(points2D, (p) => p.X);
  const maxX = maxOf(points2D, (p) => p.X);
  const minY = minOf(points2D, (p) => p.Y);
  const maxY = maxOf(points2D, (p) => p.Y);

  const dx = maxX - minX;
  const dy = maxY - minY;
  const margin = Math.max(dx, dy) * 0.5;

  const superTriangle: IndexedPoint2D[] = [
    { X: minX - margin, Y: minY - margin, Index: -1 },
    { X: maxX + margin * 2, Y: minY - margin, Index: -2 },
    { X: (minX + maxX) / 2, Y: maxY + margin * 2, Index: -3 },
  ];

  const getPoint = (idx: number): IndexedPoint2D => (idx < 0 ? superTriangle[-idx - 1] : points2D[idx]);

  const getTrianglePoints = (t: Triangle): [IndexedPoint2D, IndexedPoint2D, IndexedPoint2D] => [
    getPoint(t[0]),
    getPoint(t[1]),
    getPoint(t[2]),
  ];

  let triangles: Triangle[] = [[superTriangle[0].Index, superTriangle[1].Index, superTriangle[2].Index]];

  for (const point of points2D) {
    const badTriangles: Triangle[] = [];
    for (const triangle of triangles) {
      const [p1, p2, p3] = getTrianglePoints(triangle);
      if (isPointInCircumcircle(point, p1, p2, p3)) {
        badTriangles.push(triangle);
      }
    }

    const edges: Array<[number, number]> = [];
    for (const triangle of badTriangles) {
      edges.push([triangle[0], triangle[1]]);
      edges.push([triangle[1], triangle[2]]);
      edges.push([triangle[2], triangle[0]]);
    }

    // `key` (sorted) is used only to detect duplicate/shared edges between bad
    // triangles; `original` (the edge's actual CCW-consistent direction as it
    // appeared on its triangle) is what gets reconstructed into a new triangle below.
    const edgeCounts = new Map<string, { original: [number, number]; count: number }>();
    for (const edge of edges) {
      const key: [number, number] = edge[0] < edge[1] ? edge : [edge[1], edge[0]];
      const keyStr = `${key[0]},${key[1]}`;
      const existing = edgeCounts.get(keyStr);
      if (existing) existing.count += 1;
      else edgeCounts.set(keyStr, { original: edge, count: 1 });
    }

    const boundaryEdges: Array<[number, number]> = [];
    for (const { original, count } of edgeCounts.values()) {
      if (count === 1) boundaryEdges.push(original);
    }

    for (const bad of badTriangles) {
      const idx = triangles.findIndex((t) => t[0] === bad[0] && t[1] === bad[1] && t[2] === bad[2]);
      if (idx !== -1) triangles.splice(idx, 1);
    }

    for (const edge of boundaryEdges) {
      triangles.push([edge[0], edge[1], point.Index]);
    }
  }

  triangles = triangles.filter((t) => t[0] >= 0 && t[1] >= 0 && t[2] >= 0);

  let totalEdgeLength = 0;
  let validTriangleCount = 0;
  for (const triangle of triangles) {
    if (triangle[0] >= 0 && triangle[1] >= 0 && triangle[2] >= 0) {
      const v0 = points[triangle[0]];
      const v1 = points[triangle[1]];
      const v2 = points[triangle[2]];
      totalEdgeLength += distance(v0, v1);
      totalEdgeLength += distance(v1, v2);
      totalEdgeLength += distance(v2, v0);
      validTriangleCount++;
    }
  }
  const avgEdgeLengthVal = validTriangleCount > 0 ? totalEdgeLength / (validTriangleCount * 3) : 100.0;
  const maxEdgeLengthVal = avgEdgeLengthVal * MAX_EDGE_LENGTH_RATIO;

  const faces: number[][] = [];
  for (const triangle of triangles) {
    if (triangle[0] < 0 || triangle[1] < 0 || triangle[2] < 0) continue;

    const v0 = points[triangle[0]];
    const v1 = points[triangle[1]];
    const v2 = points[triangle[2]];

    const edge1 = distance(v0, v1);
    const edge2 = distance(v1, v2);
    const edge3 = distance(v2, v0);

    if (edge1 > maxEdgeLengthVal || edge2 > maxEdgeLengthVal || edge3 > maxEdgeLengthVal) continue;

    faces.push([triangle[0], triangle[1], triangle[2]]);
  }

  return faces;
}

/** Mirrors MeshGenerationService.IsPointInCircumcircle - standard in-circumcircle determinant test. */
function isPointInCircumcircle(
  point: IndexedPoint2D,
  p1: IndexedPoint2D,
  p2: IndexedPoint2D,
  p3: IndexedPoint2D,
): boolean {
  const ax = p1.X - point.X;
  const ay = p1.Y - point.Y;
  const bx = p2.X - point.X;
  const by = p2.Y - point.Y;
  const cx = p3.X - point.X;
  const cy = p3.Y - point.Y;

  const det =
    ax * (by * (cx * cx + cy * cy) - cy * (bx * bx + by * by)) -
    ay * (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) +
    (ax * ax + ay * ay) * (bx * cy - by * cx);

  return det > 0;
}

/** Mirrors MeshGenerationService.BuildVertexAdjacency. */
function buildVertexAdjacency(mesh: Mesh): Map<number, Set<number>> {
  const adjacency = new Map<number, Set<number>>();

  for (const face of mesh.Faces) {
    if (face.length < 2) continue;

    for (let i = 0; i < face.length; i++) {
      const v0 = face[i];
      const v1 = face[(i + 1) % face.length];

      if (!adjacency.has(v0)) adjacency.set(v0, new Set());
      if (!adjacency.has(v1)) adjacency.set(v1, new Set());

      adjacency.get(v0)!.add(v1);
      adjacency.get(v1)!.add(v0);
    }
  }

  return adjacency;
}

/** Mirrors MeshGenerationService.IdentifyBoundaryVertices. */
function identifyBoundaryVertices(mesh: Mesh): Set<number> {
  const boundaryVertices = new Set<number>();
  const edgeCounts = new Map<string, { v0: number; v1: number; count: number }>();

  for (const face of mesh.Faces) {
    if (face.length < 2) continue;

    for (let i = 0; i < face.length; i++) {
      const v0 = face[i];
      const v1 = face[(i + 1) % face.length];
      const [a, b] = v0 < v1 ? [v0, v1] : [v1, v0];
      const key = `${a},${b}`;
      const existing = edgeCounts.get(key);
      if (existing) existing.count += 1;
      else edgeCounts.set(key, { v0: a, v1: b, count: 1 });
    }
  }

  for (const { v0, v1, count } of edgeCounts.values()) {
    if (count === 1) {
      boundaryVertices.add(v0);
      boundaryVertices.add(v1);
    }
  }

  return boundaryVertices;
}

/** Mirrors MeshGenerationService.CalculateTriangleArea. */
function calculateTriangleArea(a: Point3D, b: Point3D, c: Point3D): number {
  const abx = b.X - a.X;
  const aby = b.Y - a.Y;
  const abz = b.Z - a.Z;
  const acx = c.X - a.X;
  const acy = c.Y - a.Y;
  const acz = c.Z - a.Z;

  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;

  return 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
}

// =====================================================================================
// FastMeshService.cs
// =====================================================================================

/**
 * Mirrors FastMeshService.CreateWatertightMesh.
 *
 * IMPORTANT GAP: the original built a genuinely watertight mesh via 3D tetrahedral
 * Delaunay triangulation (MIConvexHull), only falling back to the 2.5D path on rare
 * library failures (e.g. degenerate/coplanar input). Since `delaunayTriangulate3D`
 * below always throws `Delaunay3DNotSupportedError` (no 3D triangulation library is
 * available - see the file-level comment), THIS FUNCTION NOW ALWAYS TAKES THE 2.5D
 * FALLBACK PATH. The control flow (try 3D, catch, fall back to 2.5D, log a warning)
 * is preserved exactly from the original, but in practice every call produces a
 * height-field-style 2.5D triangulation rather than a true watertight 3D solid.
 * Downstream consumers relying on watertightness need the WASM-based follow-up
 * mentioned in `Delaunay3DNotSupportedError`.
 */
export function createWatertightMesh(
  points: LidarPoint3D[],
  targetMeshPoints = 20000,
  alphaValue = 30.0,
  smoothingIterations = 5,
): Mesh {
  if (!points || points.length < 4) return emptyMesh();

  const meshPoints = downsampleForMesh(points, targetMeshPoints);

  let mesh: Mesh;
  try {
    mesh = delaunayTriangulate3D(meshPoints);
  } catch (err) {
    console.warn(
      `  FastMeshService: 3D Delaunay triangulation unavailable (${(err as Error).message}); falling back to 2.5D triangulation.`,
    );
    mesh = triangulate2_5D(meshPoints);
  }

  if (mesh.Faces.length === 0) {
    return mesh;
  }

  mesh = applyAlphaShape(mesh, alphaValue);
  mesh = closeHoles(mesh);

  if (smoothingIterations > 0) {
    mesh = smoothMeshLaplacian(mesh, smoothingIterations, DEFAULT_SMOOTHING_LAMBDA);
  }

  mesh = computeNormals(mesh);
  mesh = assignColorsToMesh(mesh, meshPoints);

  return mesh;
}

/** Mirrors FastMeshService.DownsampleForMesh - voxel-grid averaging to hit a target point count. */
export function downsampleForMesh(points: LidarPoint3D[], targetCount: number): LidarPoint3D[] {
  if (points.length <= targetCount) return [...points];

  let minX = Number.MAX_VALUE;
  let maxX = -Number.MAX_VALUE;
  let minY = Number.MAX_VALUE;
  let maxY = -Number.MAX_VALUE;
  let minZ = Number.MAX_VALUE;
  let maxZ = -Number.MAX_VALUE;

  for (const p of points) {
    if (p.X < minX) minX = p.X;
    if (p.X > maxX) maxX = p.X;
    if (p.Y < minY) minY = p.Y;
    if (p.Y > maxY) maxY = p.Y;
    if (p.Z < minZ) minZ = p.Z;
    if (p.Z > maxZ) maxZ = p.Z;
  }

  const volume = (maxX - minX) * (maxY - minY) * (maxZ - minZ);
  const voxelVolume = volume / targetCount;
  const voxelSize = Math.max(Math.pow(voxelVolume, 1.0 / 3.0), 1.0);

  const voxelGrid = new Map<string, LidarPoint3D[]>();

  for (const p of points) {
    const vx = Math.floor((p.X - minX) / voxelSize);
    const vy = Math.floor((p.Y - minY) / voxelSize);
    const vz = Math.floor((p.Z - minZ) / voxelSize);
    const key = `${vx},${vy},${vz}`;
    const bucket = voxelGrid.get(key);
    if (bucket) bucket.push(p);
    else voxelGrid.set(key, [p]);
  }

  const result: LidarPoint3D[] = [];
  for (const voxel of voxelGrid.values()) {
    const representative = voxel[0];
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    for (const p of voxel) {
      sumX += p.X;
      sumY += p.Y;
      sumZ += p.Z;
    }
    result.push({
      X: sumX / voxel.length,
      Y: sumY / voxel.length,
      Z: sumZ / voxel.length,
      Intensity: representative.Intensity,
      Classification: representative.Classification,
      Color: representative.Color,
    });
  }

  return result;
}

/**
 * Mirrors FastMeshService.DelaunayTriangulate3D's entry guard, but ALWAYS throws
 * `Delaunay3DNotSupportedError` instead of attempting real 3D tetrahedral Delaunay
 * triangulation - see the file-level comment and the "IMPORTANT GAP" note on
 * `createWatertightMesh`. This fails loudly and explicitly rather than silently
 * producing wrong/corrupt 3D geometry via a hand-rolled (and likely buggy)
 * implementation.
 */
export function delaunayTriangulate3D(points: LidarPoint3D[]): Mesh {
  if (points.length < 4) return emptyMesh();
  throw new Delaunay3DNotSupportedError();
}

/**
 * Mirrors FastMeshService.Triangulate2_5D. The original used MIConvexHull's 2D
 * Delaunay (`Triangulation.CreateDelaunay<Vertex2D, Triangle2D>`); this uses the
 * `delaunator` npm package instead (fast, widely-used, actively maintained 2D
 * Delaunay triangulation). Triangulates on X/Y only, matching the original.
 */
export function triangulate2_5D(points: LidarPoint3D[]): Mesh {
  const vertices: Point3D[] = points.map((p) => ({ X: p.X, Y: p.Y, Z: p.Z }));
  const colors: [number, number, number][] = points.map((p) => parseColor(p.Color));

  const mesh: Mesh = { Vertices: vertices, Normals: [], Faces: [], Colors: colors };

  if (points.length < 3) return mesh;

  try {
    const coords = new Float64Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      coords[2 * i] = points[i].X;
      coords[2 * i + 1] = points[i].Y;
    }

    const delaunay = new Delaunator(coords);
    const triangles = delaunay.triangles;

    for (let i = 0; i < triangles.length; i += 3) {
      mesh.Faces.push([triangles[i], triangles[i + 1], triangles[i + 2]]);
    }
  } catch (err) {
    console.warn(`  Error in 2.5D triangulation: ${(err as Error).message}`);
  }

  return mesh;
}

/** Mirrors FastMeshService.ApplyAlphaShape - drops faces with any edge longer than `alphaMultiplier` times the mesh's average edge length. */
export function applyAlphaShape(mesh: Mesh, alphaMultiplier: number): Mesh {
  if (mesh.Faces.length === 0) return mesh;

  let totalLength = 0;
  let edgeCount = 0;

  for (const face of mesh.Faces) {
    if (face.length < 3) continue;
    const v0 = mesh.Vertices[face[0]];
    const v1 = mesh.Vertices[face[1]];
    const v2 = mesh.Vertices[face[2]];

    totalLength += distance(v0, v1);
    totalLength += distance(v1, v2);
    totalLength += distance(v2, v0);
    edgeCount += 3;
  }

  const avgEdgeLength = edgeCount > 0 ? totalLength / edgeCount : 1.0;
  const maxEdgeLength = avgEdgeLength * alphaMultiplier;

  const filteredFaces: number[][] = [];
  for (const face of mesh.Faces) {
    if (face.length < 3) continue;
    const v0 = mesh.Vertices[face[0]];
    const v1 = mesh.Vertices[face[1]];
    const v2 = mesh.Vertices[face[2]];

    if (distance(v0, v1) <= maxEdgeLength && distance(v1, v2) <= maxEdgeLength && distance(v2, v0) <= maxEdgeLength) {
      filteredFaces.push(face);
    }
  }

  return { Vertices: mesh.Vertices, Normals: mesh.Normals, Faces: filteredFaces, Colors: mesh.Colors };
}

/** Mirrors FastMeshService.CloseHoles - fills boundary-edge loops with a fan of triangles around each loop's centroid. */
export function closeHoles(mesh: Mesh): Mesh {
  if (mesh.Faces.length === 0) return mesh;

  const newFaces: number[][] = [...mesh.Faces];
  const edgeCounts = new Map<string, { v1: number; v2: number; count: number }>();

  for (const face of mesh.Faces) {
    if (face.length < 3) continue;

    const edges: Array<[number, number]> = [
      [face[0], face[1]],
      [face[1], face[2]],
      [face[2], face[0]],
    ];

    for (const [v1, v2] of edges) {
      const key = v1 < v2 ? `${v1},${v2}` : `${v2},${v1}`;
      const existing = edgeCounts.get(key);
      if (existing) existing.count += 1;
      else edgeCounts.set(key, { v1, v2, count: 1 });
    }
  }

  const boundaryEdges: Array<[number, number]> = [];
  for (const { v1, v2, count } of edgeCounts.values()) {
    if (count === 1) boundaryEdges.push([v1, v2]);
  }

  if (boundaryEdges.length === 0) return mesh;

  const { filledFaces, newVertices, newColors } = fillBoundaryLoops(boundaryEdges, mesh.Vertices, mesh.Colors);
  newFaces.push(...filledFaces);

  return {
    Vertices: [...mesh.Vertices, ...newVertices],
    Normals: mesh.Normals,
    Faces: newFaces,
    Colors: [...mesh.Colors, ...newColors],
  };
}

/** Mirrors FastMeshService.FillBoundaryLoops. */
function fillBoundaryLoops(
  boundaryEdges: Array<[number, number]>,
  vertices: Point3D[],
  colors: [number, number, number][],
): { filledFaces: number[][]; newVertices: Point3D[]; newColors: [number, number, number][] } {
  const filledFaces: number[][] = [];
  const newVertices: Point3D[] = [];
  const newColors: [number, number, number][] = [];
  const usedEdges = new Set<string>();

  const adjacency = new Map<number, number[]>();
  for (const [v1, v2] of boundaryEdges) {
    if (!adjacency.has(v1)) adjacency.set(v1, []);
    if (!adjacency.has(v2)) adjacency.set(v2, []);
    adjacency.get(v1)!.push(v2);
    adjacency.get(v2)!.push(v1);
  }

  const maxLoops = 100;
  let loopCount = 0;
  const baseVertexCount = vertices.length;

  for (const startVertex of adjacency.keys()) {
    if (loopCount >= maxLoops) break;

    const loop = findLoop(startVertex, adjacency, usedEdges);
    if (loop && loop.length >= 3) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const i of loop) {
        cx += vertices[i].X;
        cy += vertices[i].Y;
        cz += vertices[i].Z;
      }
      const centroid: Point3D = { X: cx / loop.length, Y: cy / loop.length, Z: cz / loop.length };

      let r = 0;
      let g = 0;
      let b = 0;
      if (colors.length > 0) {
        for (const idx of loop) {
          if (idx < colors.length) {
            r += colors[idx][0];
            g += colors[idx][1];
            b += colors[idx][2];
          }
        }
        r /= loop.length;
        g /= loop.length;
        b /= loop.length;
      } else {
        r = g = b = 0.5;
      }

      const centroidIdx = baseVertexCount + newVertices.length;
      newVertices.push(centroid);
      newColors.push([r, g, b]);

      for (let i = 0; i < loop.length; i++) {
        const lv1 = loop[i];
        const lv2 = loop[(i + 1) % loop.length];
        filledFaces.push([lv1, lv2, centroidIdx]);
      }

      loopCount++;
    }
  }

  return { filledFaces, newVertices, newColors };
}

/** Mirrors FastMeshService.FindLoop - walks unused boundary edges from `startVertex` until it closes a loop or gets stuck. */
function findLoop(startVertex: number, adjacency: Map<number, number[]>, usedEdges: Set<string>): number[] | null {
  const loop: number[] = [startVertex];
  const visited = new Set<number>([startVertex]);
  let current = startVertex;
  const maxIterations = 1000;
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    const neighbors = adjacency.get(current);
    if (!neighbors) break;

    let next = -1;

    for (const neighbor of neighbors) {
      const edgeKey = current < neighbor ? `${current},${neighbor}` : `${neighbor},${current}`;
      if (!usedEdges.has(edgeKey)) {
        if (neighbor === startVertex && loop.length >= 3) {
          usedEdges.add(edgeKey);
          return loop;
        } else if (!visited.has(neighbor)) {
          next = neighbor;
          usedEdges.add(edgeKey);
          break;
        }
      }
    }

    if (next === -1) break;

    loop.push(next);
    visited.add(next);
    current = next;
  }

  return null;
}

/** Mirrors FastMeshService.ComputeNormals - accumulates per-face flat normals onto each face's vertices, then normalizes. */
export function computeNormals(mesh: Mesh): Mesh {
  const normals: Point3D[] = mesh.Vertices.map(() => ({ X: 0, Y: 0, Z: 0 }));

  for (const face of mesh.Faces) {
    if (face.length < 3) continue;

    const v0 = mesh.Vertices[face[0]];
    const v1 = mesh.Vertices[face[1]];
    const v2 = mesh.Vertices[face[2]];

    const u = { X: v1.X - v0.X, Y: v1.Y - v0.Y, Z: v1.Z - v0.Z };
    const v = { X: v2.X - v0.X, Y: v2.Y - v0.Y, Z: v2.Z - v0.Z };

    const normal = {
      X: u.Y * v.Z - u.Z * v.Y,
      Y: u.Z * v.X - u.X * v.Z,
      Z: u.X * v.Y - u.Y * v.X,
    };

    for (const idx of face) {
      normals[idx].X += normal.X;
      normals[idx].Y += normal.Y;
      normals[idx].Z += normal.Z;
    }
  }

  for (let i = 0; i < normals.length; i++) {
    const n = normals[i];
    const length = Math.sqrt(n.X * n.X + n.Y * n.Y + n.Z * n.Z);
    normals[i] = length > 1e-9 ? { X: n.X / length, Y: n.Y / length, Z: n.Z / length } : { X: 0, Y: 1, Z: 0 };
  }

  return { Vertices: mesh.Vertices, Normals: normals, Faces: mesh.Faces, Colors: mesh.Colors };
}

/** Mirrors FastMeshService.AssignColorsToMesh - inverse-distance-weighted color from each vertex's 5 nearest downsampled source points. */
export function assignColorsToMesh(mesh: Mesh, downsampledPoints: LidarPoint3D[]): Mesh {
  if (mesh.Vertices.length === 0) return mesh;

  const colors: [number, number, number][] = [];

  for (let i = 0; i < mesh.Vertices.length; i++) {
    const vertex = mesh.Vertices[i];

    if (i < mesh.Colors.length) {
      colors.push(mesh.Colors[i]);
      continue;
    }

    const nearest = downsampledPoints
      .map((p) => ({ p, dist: distance(vertex, { X: p.X, Y: p.Y, Z: p.Z }) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5);

    if (nearest.length > 0) {
      let totalWeight = 0;
      let r = 0;
      let g = 0;
      let b = 0;

      for (const { p, dist } of nearest) {
        const weight = dist > 0 ? 1.0 / (dist * dist + 0.1) : 10.0;
        const [pr, pg, pb] = parseColor(p.Color);
        r += pr * weight;
        g += pg * weight;
        b += pb * weight;
        totalWeight += weight;
      }

      colors.push(totalWeight > 0 ? [r / totalWeight, g / totalWeight, b / totalWeight] : [0.5, 0.5, 0.5]);
    } else {
      colors.push([0.5, 0.5, 0.5]);
    }
  }

  return { Vertices: mesh.Vertices, Normals: mesh.Normals, Faces: mesh.Faces, Colors: colors };
}

/** Mirrors FastMeshService.ParseColor - `#RRGGBB` to `[R, G, B]` floats in [0, 1]; mid-gray on anything malformed. */
function parseColor(colorHex: string | null | undefined): [number, number, number] {
  if (!colorHex || !colorHex.startsWith("#")) return [0.5, 0.5, 0.5];

  const hex = colorHex.substring(1);
  if (hex.length === 6) {
    const r = Number.parseInt(hex.substring(0, 2), 16);
    const g = Number.parseInt(hex.substring(2, 4), 16);
    const b = Number.parseInt(hex.substring(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return [r / 255.0, g / 255.0, b / 255.0];
    }
  }

  return [0.5, 0.5, 0.5];
}

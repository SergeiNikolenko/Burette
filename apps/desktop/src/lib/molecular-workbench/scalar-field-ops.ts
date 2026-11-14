import type { ScalarGrid, Vec3 } from "./scientific-types";
import { BOHR_ANGSTROM } from "./quantum";

export type FieldOperation = "difference" | "sum" | "scale";

/** Fields from separate files share a grid when their points coincide; header rounding stays below 1e-6 Å. */
export function sameGrid(a: ScalarGrid, b: ScalarGrid) {
  const left = [...a.origin, ...a.axes.flat()];
  const right = [...b.origin, ...b.axes.flat()];
  return a.dimensions.every((value, i) => value === b.dimensions[i]) && left.every((value, i) => Math.abs(value - right[i]) < 1e-6);
}

/** A − B, A + B or k·A, point by point, on A's grid. */
export function combineGrids(operation: FieldOperation, a: ScalarGrid, b: ScalarGrid | null, factor = 1): ScalarGrid {
  const values = new Float32Array(a.values.length);
  if (operation === "scale") {
    if (!Number.isFinite(factor)) throw new Error("The factor must be a finite number.");
    for (let i = 0; i < values.length; i++) values[i] = factor * a.values[i];
  } else {
    if (!b || !sameGrid(a, b)) throw new Error("Both fields need the same grid.");
    const sign = operation === "difference" ? -1 : 1;
    for (let i = 0; i < values.length; i++) values[i] = a.values[i] + sign * b.values[i];
  }
  return { dimensions: [...a.dimensions], origin: [...a.origin], axes: [[...a.axes[0]], [...a.axes[1]], [...a.axes[2]]], values };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Σ value × voxel volume in bohr³, the unit Cube fields are per (e/bohr³ for densities), so a
 * density integrates to electrons. Grid points sample the field; there is no edge weighting.
 */
export function integrateGrid(grid: ScalarGrid) {
  const voxel = Math.abs(dot(grid.axes[0], cross(grid.axes[1], grid.axes[2]))) / BOHR_ANGSTROM ** 3;
  let sum = 0;
  for (const value of grid.values) sum += value;
  return sum * voxel;
}

export type SliceAxis = 0 | 1 | 2;

/** One grid plane: `values[j * width + i]` is the field at origin + i·u + j·v (Å). */
export interface GridSlice { width: number; height: number; origin: Vec3; u: Vec3; v: Vec3; normal: Vec3; values: Float32Array }

/** The plane of grid points with index `index` along `axis`; the other two axes keep their order. */
export function sliceGrid(grid: ScalarGrid, axis: SliceAxis, index: number): GridSlice {
  const [, ny, nz] = grid.dimensions;
  if (!Number.isInteger(index) || index < 0 || index >= grid.dimensions[axis]) throw new Error("The slice is outside the grid.");
  const [first, second] = ([0, 1, 2] as const).filter((value) => value !== axis);
  const width = grid.dimensions[first];
  const height = grid.dimensions[second];
  const values = new Float32Array(width * height);
  const at = (p: [number, number, number]) => (p[0] * ny + p[1]) * nz + p[2];
  const point: [number, number, number] = [0, 0, 0];
  point[axis] = index;
  for (let j = 0; j < height; j++) {
    point[second] = j;
    for (let i = 0; i < width; i++) {
      point[first] = i;
      values[j * width + i] = grid.values[at(point)];
    }
  }
  const step = grid.axes[axis];
  const origin: Vec3 = [0, 1, 2].map((k) => grid.origin[k] + index * step[k]) as Vec3;
  return { width, height, origin, u: grid.axes[first], v: grid.axes[second], normal: step, values };
}

/**
 * Contour segments of `level` by marching squares, in grid units of the slice (x along u, y along v).
 * Saddle cells take the split the cell centre's average favours.
 */
export function contourSegments(slice: Pick<GridSlice, "width" | "height" | "values">, level: number) {
  const { width, height, values } = slice;
  const segments: number[] = [];
  const cross = (a: number, b: number) => (level - a) / (b - a);
  for (let j = 0; j + 1 < height; j++) {
    for (let i = 0; i + 1 < width; i++) {
      const a = values[j * width + i], b = values[j * width + i + 1];
      const c = values[(j + 1) * width + i + 1], d = values[(j + 1) * width + i];
      const edges: Array<[number, number]> = [];
      // Edges in order bottom (a→b), right (b→c), top (d→c), left (a→d).
      if ((a > level) !== (b > level)) edges.push([i + cross(a, b), j]);
      if ((b > level) !== (c > level)) edges.push([i + 1, j + cross(b, c)]);
      if ((d > level) !== (c > level)) edges.push([i + cross(d, c), j + 1]);
      if ((a > level) !== (d > level)) edges.push([i, j + cross(a, d)]);
      if (edges.length === 2) segments.push(...edges[0], ...edges[1]);
      else if (edges.length === 4) {
        // Corners a and c are on one side. A centre above the level joins the high corners' regions.
        const centreHigh = (a + b + c + d) / 4 > level;
        const [bottom, right, top, left] = edges;
        if (centreHigh === (a > level)) segments.push(...bottom, ...right, ...top, ...left);
        else segments.push(...bottom, ...left, ...top, ...right);
      }
    }
  }
  return segments;
}

/** A colour range for the field: the 99th percentile of |value|, two significant digits. */
export function fieldLimit(values: Float32Array) {
  const step = Math.max(1, Math.floor(values.length / 200_000));
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += step) if (Number.isFinite(values[i])) sample.push(Math.abs(values[i]));
  sample.sort((a, b) => a - b);
  const limit = sample[Math.min(sample.length - 1, Math.floor(sample.length * 0.99))] ?? 0;
  return limit > 0 ? Number(limit.toPrecision(2)) : 1;
}

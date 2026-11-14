import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gridToCube, parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { combineGrids, contourSegments, integrateGrid, sliceGrid } from "../apps/desktop/src/lib/molecular-workbench/scalar-field-ops";
import type { ScalarGrid } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/quantum/cube-pair/${name}`, import.meta.url), "utf8");
const cube = (name: string) => {
  const document = parseScientificFile(name, fixture(name));
  if (!document.grid) throw new Error(`${name} has no grid`);
  return document;
};

test("the neutral minus cation water density integrates to the removed electron", () => {
  const neutral = cube("water-density.cube");
  const cation = cube("water-cation-density.cube");
  const difference = combineGrids("difference", neutral.grid!, cation.grid!);
  // NumPy on the same files gives 0.98260 (README); the exact answer is one electron.
  expect(integrateGrid(difference)).toBeCloseTo(0.9826, 4);
  expect(Math.abs(integrateGrid(difference) - 1)).toBeLessThan(0.02);
  expect(integrateGrid(combineGrids("sum", difference, cation.grid!))).toBeCloseTo(integrateGrid(neutral.grid!), 4);
  expect(integrateGrid(combineGrids("scale", neutral.grid!, null, -2))).toBeCloseTo(-2 * integrateGrid(neutral.grid!), 4);
});

test("a new field written as a Cube reads back with the same values", () => {
  const neutral = cube("water-density.cube");
  const difference = combineGrids("difference", neutral.grid!, cube("water-cation-density.cube").grid!);
  const reread = parseScientificFile("difference.cube", gridToCube(difference, neutral.atoms));
  expect(integrateGrid(reread.grid!)).toBeCloseTo(integrateGrid(difference), 4);
  expect(reread.atoms.map((atom) => atom.element)).toEqual(["O", "H", "H"]);
});

test("fields on different grids do not combine", () => {
  const grid = cube("water-density.cube").grid!;
  const shifted: ScalarGrid = { ...grid, origin: [grid.origin[0] + 0.1, grid.origin[1], grid.origin[2]] };
  expect(() => combineGrids("difference", grid, shifted)).toThrow("same grid");
});

test("slice values are the Cube's values at its grid points", () => {
  // Read the file's numbers directly: after the six header lines and the atoms, x is slowest and z fastest.
  const lines = fixture("water-potential.cube").split("\n");
  const atomCount = Math.abs(Number(lines[2].trim().split(/\s+/u)[0]));
  const raw = lines.slice(6 + atomCount).join(" ").trim().split(/\s+/u).map(Number);
  const grid = cube("water-potential.cube").grid!;
  const [, ny, nz] = grid.dimensions;
  const at = (x: number, y: number, z: number) => raw[(x * ny + y) * nz + z];
  for (const [axis, index] of [[0, 11], [1, 3], [2, 20]] as const) {
    const slice = sliceGrid(grid, axis, index);
    for (const [i, j] of [[0, 0], [5, 17], [23, 23], [12, 11]]) {
      const point: [number, number, number] = [0, 0, 0];
      const [first, second] = [0, 1, 2].filter((value) => value !== axis);
      point[axis] = index; point[first] = i; point[second] = j;
      expect(slice.values[j * slice.width + i]).toBeCloseTo(at(...point), 6);
    }
    // The slice plane passes through grid point index along the sliced axis.
    expect(slice.origin[axis]).toBeCloseTo(grid.origin[axis] + index * grid.axes[axis][axis], 6);
  }
  expect(() => sliceGrid(grid, 2, 24)).toThrow("outside");
});

test("contours of a paraboloid lie on its circle", () => {
  const width = 41, height = 41, values = new Float32Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) values[j * width + i] = (i - 20) ** 2 + (j - 20) ** 2;
  const segments = contourSegments({ width, height, values }, 100);
  expect(segments.length).toBeGreaterThan(40 * 4);
  for (let k = 0; k < segments.length; k += 2) {
    // Linear interpolation of r² between neighbouring points stays within 0.05 of the radius 10.
    expect(Math.abs(Math.hypot(segments[k] - 20, segments[k + 1] - 20) - 10)).toBeLessThan(0.05);
  }
});

test("a saddle cell joins the corners its centre agrees with", () => {
  // Corners a=1 (0,0), b=0 (1,0), c=1 (1,1), d=0 (0,1); the centre averages 0.5 > 0.4, so the high corners connect.
  const segments = contourSegments({ width: 2, height: 2, values: Float32Array.from([1, 0, 0, 1]) }, 0.4);
  // The two segments cut off b (bottom → right) and d (top → left), leaving a and c joined.
  expect(segments.map((value) => +value.toFixed(6))).toEqual([0.6, 0, 1, 0.4, 0.4, 1, 0, 0.6]);
});

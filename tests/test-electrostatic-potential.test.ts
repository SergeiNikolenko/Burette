import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { coulombPotential, coulombPotentialGrid, surfacePotentialLimit, VAN_DER_WAALS_ISOVALUE, vanDerWaalsField } from "../apps/desktop/src/lib/molecular-workbench/electrostatic-potential";
import { gridsToCube, parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import type { MolecularAtom } from "../apps/desktop/src/lib/molecular-workbench/types";

const atoms = (rows: [string, number, number, number][]): MolecularAtom[] => rows.map(([element, x, y, z]) => ({ element, x, y, z }));
// TIP3P charges on the water geometry.
const water = atoms([["O", 0, 0, 0.1173], ["H", 0, 0.7572, -0.4692], ["H", 0, -0.7572, -0.4692]]);
const waterCharges = [-0.834, 0.417, 0.417];
const formaldehyde = atoms([["C", 0, 0, -0.5297], ["O", 0, 0, 0.6753], ["H", 0, 0.9347, -1.1192], ["H", 0, -0.9347, -1.1192]]);
const formaldehydeCharges = [0.35, -0.43, 0.04, 0.04];

// Reference values: an independent Python Coulomb sum, Σ q / (|r − rᵢ| / 0.529177210903 Å), in hartree per e.
const references: [MolecularAtom[], number[], [number, number, number], number][] = [
  [water, waterCharges, [0, 0, 1.9173], -0.0689159057708468],
  [water, waterCharges, [0, 1.9, -1.2], 0.0518574436064137],
  [water, waterCharges, [1.8, 0, 0.1173], -0.028734379371129964],
  [formaldehyde, formaldehydeCharges, [0, 0, 2.4753], -0.05338152247764473],
  [formaldehyde, formaldehydeCharges, [0, 0, -2.3297], 0.05485382374785312],
  [formaldehyde, formaldehydeCharges, [1.9, 0, 0], -0.0012706303893751623],
];

test("the potential at points on the water and formaldehyde surfaces matches an independent Coulomb sum", () => {
  for (const [molecule, charges, point, expected] of references) expect(coulombPotential(molecule, charges, point)).toBeCloseTo(expected, 12);
});

test("the potential grid holds the potential at its own points, z fastest, and the van der Waals field it colours crosses its isovalue at the atomic radius", () => {
  const grid = coulombPotentialGrid(formaldehyde, formaldehydeCharges);
  const [nx, ny, nz] = grid.dimensions;
  expect(grid.axes).toEqual([[0.3, 0, 0], [0, 0.3, 0], [0, 0, 0.3]]);
  expect(nx * ny * nz).toBe(grid.values.length);
  for (const [x, y, z] of [[0, 0, 0], [nx - 1, 3, nz - 1], [Math.floor(nx / 2), Math.floor(ny / 2), nz - 9], [5, ny - 1, 7]]) {
    const point = [grid.origin[0] + 0.3 * x, grid.origin[1] + 0.3 * y, grid.origin[2] + 0.3 * z] as [number, number, number];
    expect(grid.values[(x * ny + y) * nz + z]).toBeCloseTo(Math.fround(coulombPotential(formaldehyde, formaldehydeCharges, point)), 6);
  }
  // The van der Waals field is 1 at an isolated atom's radius: just outside the oxygen's 1.52 Å along the C=O axis.
  const surface = vanDerWaalsField(formaldehyde, grid), along = (z: number) => surface.values[(Math.round(-grid.origin[0] / 0.3) * ny + Math.round(-grid.origin[1] / 0.3)) * nz + z];
  const outward = Array.from({ length: nz }, (_, z) => z).filter(z => grid.origin[2] + 0.3 * z > 0.6753);
  const crossing = outward.find(z => along(z) < VAN_DER_WAALS_ISOVALUE)!;
  expect(grid.origin[2] + 0.3 * crossing - 0.6753).toBeGreaterThan(1.52 - 0.3);
  expect(grid.origin[2] + 0.3 * crossing - 0.6753).toBeLessThan(1.52 + 0.3);
  // The default colour limit is the size of the potential on the surface: 0.07 to 0.1 hartree/e.
  const waterGrid = coulombPotentialGrid(water, waterCharges);
  expect([surfacePotentialLimit(surface, VAN_DER_WAALS_ISOVALUE, grid), surfacePotentialLimit(vanDerWaalsField(water, waterGrid), VAN_DER_WAALS_ISOVALUE, waterGrid)]).toEqual([0.071, 0.097]);
});

test("a density and potential Cube pair shares its grid, and the charge potential agrees in sign on the density surface", () => {
  const read = (name: string) => parseScientificFile(name, readFileSync(new URL(`fixtures/quantum/cube-pair/${name}`, import.meta.url), "utf8"));
  const density = read("water-density.cube"), potential = read("water-potential.cube");
  expect([density.grid!.dimensions, density.grid!.origin, density.grid!.axes]).toEqual([potential.grid!.dimensions, potential.grid!.origin, potential.grid!.axes]);
  // Points near the 0.0004 e/bohr³ isosurface, where cubegen's convention draws the potential.
  const { dimensions: [, ny, nz], origin, axes } = density.grid!;
  const surface = Array.from(density.grid!.values.keys()).filter(index => density.grid!.values[index] > 0.0003 && density.grid!.values[index] < 0.0005);
  const position = (index: number) => [0, 1, 2].map(k => origin[k] + Math.floor(index / (ny * nz)) * axes[0][k] + (Math.floor(index / nz) % ny) * axes[1][k] + (index % nz) * axes[2][k]) as [number, number, number];
  const agree = surface.filter(index => Math.sign(potential.grid!.values[index]) === Math.sign(coulombPotential(water, waterCharges, position(index))));
  expect(surface.length).toBeGreaterThan(100);
  expect(agree.length / surface.length).toBeGreaterThan(0.9);
  // The B3LYP potential on that surface spans about ±0.054 hartree/e, the default colour range.
  expect(surfacePotentialLimit(density.grid!, 0.0004, potential.grid!)).toBe(0.054);
});

test("a surface field and the potential colouring it travel as one two-field Cube on their shared grid", () => {
  const potential = coulombPotentialGrid(water, waterCharges, 0.6);
  const density = { ...potential, values: potential.values.map(value => Math.abs(value)) };
  const cube = gridsToCube([density, potential], water);
  const reopened = parseScientificFile("pair.cube", cube);
  expect(reopened.gridDatasets?.map(dataset => Array.from(dataset.grid.values))).toEqual([density, potential].map(grid => Array.from(grid.values, value => Math.fround(Number(value.toExponential(7))))));
  expect(reopened.atoms.map(atom => atom.element)).toEqual(["O", "H", "H"]);
  expect(() => gridsToCube([density, { ...potential, origin: [0, 0, 0] }], water)).toThrow("same grid");
});

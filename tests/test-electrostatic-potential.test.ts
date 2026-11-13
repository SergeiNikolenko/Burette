import { expect, test } from "bun:test";
import { coulombPotential, coulombPotentialGrid, surfacePotentialLimit } from "../apps/desktop/src/lib/molecular-workbench/electrostatic-potential";
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

test("the potential grid holds the potential at its own points, z fastest, and draws from the values near the surface", () => {
  const grid = coulombPotentialGrid(formaldehyde, formaldehydeCharges);
  const [nx, ny, nz] = grid.dimensions;
  expect(grid.axes).toEqual([[0.3, 0, 0], [0, 0.3, 0], [0, 0, 0.3]]);
  expect(nx * ny * nz).toBe(grid.values.length);
  for (const [x, y, z] of [[0, 0, 0], [nx - 1, 3, nz - 1], [Math.floor(nx / 2), Math.floor(ny / 2), nz - 9], [5, ny - 1, 7]]) {
    const point = [grid.origin[0] + 0.3 * x, grid.origin[1] + 0.3 * y, grid.origin[2] + 0.3 * z] as [number, number, number];
    expect(grid.values[(x * ny + y) * nz + z]).toBeCloseTo(Math.fround(coulombPotential(formaldehyde, formaldehydeCharges, point)), 6);
  }
  // The default colour limit is the size of the surface potentials above: about 0.05 to 0.07 hartree/e.
  expect([surfacePotentialLimit(grid, formaldehyde), surfacePotentialLimit(coulombPotentialGrid(water, waterCharges), water)]).toEqual([0.052, 0.066]);
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

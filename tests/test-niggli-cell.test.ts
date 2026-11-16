import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { integerBasisTransform, reduceNiggliCell, type NiggliResult } from "../apps/desktop/src/lib/molecular-workbench/symmetry/niggli";
import { instantiateStandaloneWasm } from "../apps/desktop/src/lib/molecular-workbench/symmetry/wasm-module";
import type { UnitCell, Vec3 } from "../apps/desktop/src/lib/molecular-workbench/types";

const niggli = await instantiateStandaloneWasm(readFileSync(new URL("../apps/desktop/src/lib/molecular-workbench/symmetry/burette-niggli.wasm", import.meta.url)));
const atom = (element: string, x: number, y: number, z: number) => ({ element, x, y, z });
const determinant3 = (m: Vec3[]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

type ReferenceCase = { name: string; cell: UnitCell; reduced: UnitCell };
const reference = JSON.parse(readFileSync(new URL("fixtures/symmetry/niggli-spglib-reference.json", import.meta.url), "utf8")) as { spglib: string; eps: number; cases: ReferenceCase[] };
const multiplyColumns = (cell: UnitCell, transform: number[][]) => [0, 1, 2].map(j => [0, 1, 2].map(axis => cell.reduce((sum, vector, i) => sum + vector[axis] * transform[i][j], 0)) as Vec3) as UnitCell;
const metric = (cell: UnitCell) => cell.map(u => cell.map(v => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
const signedVolume = (cell: UnitCell) => determinant3(cell);

/** Main Niggli conditions (Křivý & Gruber 1976), checked independently of spglib. */
function expectNiggliConditions(cell: UnitCell, eps: number) {
  const g = metric(cell);
  const [A, B, C] = [g[0][0], g[1][1], g[2][2]];
  const [xi, eta, zeta] = [2 * g[1][2], 2 * g[0][2], 2 * g[0][1]];
  expect(A).toBeLessThanOrEqual(B + eps);
  expect(B).toBeLessThanOrEqual(C + eps);
  expect(Math.abs(xi)).toBeLessThanOrEqual(B + eps);
  expect(Math.abs(eta)).toBeLessThanOrEqual(A + eps);
  expect(Math.abs(zeta)).toBeLessThanOrEqual(A + eps);
  const allPositive = [xi, eta, zeta].every(value => value > eps);
  const allNonPositive = [xi, eta, zeta].every(value => value <= eps);
  expect(allPositive || allNonPositive).toBe(true);
  if (allNonPositive) expect(xi + eta + zeta + A + B).toBeGreaterThanOrEqual(-eps);
}

function expectExactBasisChange(input: UnitCell, result: NiggliResult) {
  result.transform.flat().forEach(value => expect(Number.isInteger(value)).toBe(true));
  expect(Math.abs(determinant3(result.transform))).toBe(1);
  expect(result.determinant as number).toBe(determinant3(result.transform));
  expect(multiplyColumns(input, result.transform)).toEqual(result.cell);
  const identity = [0, 1, 2].map(i => [0, 1, 2].map(j => result.transform[i].reduce((sum, value, k) => sum + value * result.inverseTransform[k][j], 0)));
  expect(identity).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  expect(Math.abs(result.reducedVolume)).toBeCloseTo(Math.abs(result.inputVolume), 9);
}

describe("spglib Niggli reduction", () => {
  test.each(reference.cases.map(item => [item.name, item] as const))("%s matches Python spglib and is an exact basis change", (_, item) => {
    expect(reference.spglib).toBe("2.8.0");
    const result = reduceNiggliCell(niggli, { cell: item.cell, eps: reference.eps });
    result.cell.forEach((vector, row) => vector.forEach((value, axis) => expect(value).toBeCloseTo(item.reduced[row][axis], 9)));
    expectExactBasisChange(item.cell, result);
    expectNiggliConditions(result.cell, 1e-8);
  });

  test("the oblique [4,0,0],[3,2,0],[1,1,3] cell has the expected unimodular transform", () => {
    const cell: UnitCell = [[4, 0, 0], [3, 2, 0], [1, 1, 3]];
    const result = reduceNiggliCell(niggli, { cell });
    expect([result.cell, result.transform, result.determinant, result.inputVolume, result.reducedVolume]).toEqual([
      [[-1, 2, 0], [1, 1, 3], [3, 2, 0]],
      [[-1, 0, 0], [1, 0, 1], [0, 1, 0]],
      1,
      24,
      24,
    ]);
  });

  test("a left-handed input keeps its handedness and a unimodular transform", () => {
    const cell: UnitCell = [[4, 0, 0], [1, 1, 3], [3, 2, 0]];
    const result = reduceNiggliCell(niggli, { cell });
    expect([Math.sign(result.inputVolume), Math.sign(result.reducedVolume), Math.abs(result.determinant)]).toEqual([-1, -1, 1]);
    expect(signedVolume(result.cell)).toBeCloseTo(-24, 10);
    expectNiggliConditions(result.cell, 1e-8);
  });

  test("rebased inputs reach the same reduced metric and reduction is idempotent", () => {
    const base = reduceNiggliCell(niggli, { cell: [[4, 0, 0], [3, 2, 0], [1, 1, 3]] });
    for (const name of ["rebased-det-plus", "rebased-det-minus"]) {
      const rebased = reference.cases.find(item => item.name === name)!;
      const result = reduceNiggliCell(niggli, { cell: rebased.cell });
      metric(result.cell).forEach((row, i) => row.forEach((value, j) => expect(value).toBeCloseTo(metric(base.cell)[i][j], 9)));
    }
    const again = reduceNiggliCell(niggli, { cell: base.cell });
    expect([again.cell, again.transform]).toEqual([base.cell, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]]);
  });

  test("fractional coordinates follow f' = T⁻¹·f with Cartesian positions preserved", () => {
    const cell: UnitCell = [[4, 0, 0], [3, 2, 0], [1, 1, 3]];
    const fractional: Vec3[] = [[0.1, 0.2, 0.3], [0.75, 0.5, 0.05], [0, 0, 0]];
    const atoms = fractional.map((f, index) => {
      const [x, y, z] = [0, 1, 2].map(axis => f.reduce((sum, value, i) => sum + value * cell[i][axis], 0));
      return { element: ["C", "O", "Na"][index], x, y, z };
    });
    const result = reduceNiggliCell(niggli, { cell, atoms });
    const reduced = result.atoms!;
    fractional.forEach((f, index) => {
      const expected = [0, 1, 2].map(i => result.inverseTransform[i].reduce((sum, value, k) => sum + value * f[k], 0));
      expected.forEach((value, axis) => expect(reduced.fractional[index][axis]).toBeCloseTo(value, 12));
      const cartesian = [0, 1, 2].map(axis => reduced.fractional[index].reduce((sum, value, i) => sum + value * result.cell[i][axis], 0));
      expect(cartesian[0]).toBeCloseTo(atoms[index].x, 12);
      expect(cartesian[1]).toBeCloseTo(atoms[index].y, 12);
      expect(cartesian[2]).toBeCloseTo(atoms[index].z, 12);
      reduced.wrappedFractional[index].forEach(value => { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(1); });
      reduced.latticeShifts[index].forEach(value => expect(Number.isInteger(value)).toBe(true));
      const translation = [0, 1, 2].map(axis => reduced.latticeShifts[index].reduce((sum, value, i) => sum + value * result.cell[i][axis], 0));
      expect(reduced.wrappedAtoms[index].x + translation[0]).toBeCloseTo(atoms[index].x, 12);
      expect(reduced.wrappedAtoms[index].element).toBe(atoms[index].element);
    });
  });

  test("the integer transform is verified, never rounded blindly", () => {
    const cell: UnitCell = [[4, 0, 0], [3, 2, 0], [1, 1, 3]];
    expect(() => integerBasisTransform(cell, [[6, 0, 0], [3, 2, 0], [1, 1, 3]])).toThrow(/not an integer basis change/);
    expect(() => integerBasisTransform(cell, [[8, 0, 0], [3, 2, 0], [1, 1, 3]])).toThrow(/determinant 2/);
    expect(() => integerBasisTransform(cell, [[4 + 1e-5, 0, 0], [3, 2, 0], [1, 1, 3]])).toThrow(/not an integer basis change|does not reproduce/);
  });

  test("finite Cartesian atoms cannot overflow or use unsafe lattice translations", () => {
    const cell: UnitCell = [[0.1, 0, 0], [0, 0.1, 0], [0, 0, 0.1]];
    for (const x of [1e308, -1e308, 1e15, -1e15]) {
      expect(() => reduceNiggliCell(niggli, { cell, atoms: [atom("C", x, x, x)] })).toThrow(/safe fractional range/);
    }
    const result = reduceNiggliCell(niggli, { cell, atoms: [atom("C", 0.025, -0.025, 0.125)] });
    expect(result.atoms!.wrappedFractional[0]).toEqual([0.25, 0.75, 0.25]);
    expect(result.atoms!.latticeShifts[0]).toEqual([0, -1, 1]);
  });

  test.each([
    ["degenerate", { cell: [[1, 0, 0], [2, 0, 0], [0, 0, 1]] as UnitCell }, /independent/],
    ["non-finite", { cell: [[1, 0, 0], [0, Number.NaN, 0], [0, 0, 1]] as UnitCell }, /finite/],
    ["tolerance", { cell: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as UnitCell, eps: 0 }, /tolerance/],
    ["oversize", { cell: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as UnitCell, atoms: Array.from({ length: 100_001 }, () => ({ element: "H", x: 0, y: 0, z: 0 })) }, /at most/],
  ])("rejects %s cells", (_, input, message) => {
    expect(() => reduceNiggliCell(niggli, input)).toThrow(message);
  });
});


test("wrapping near a cell face preserves the exact site and integer translation", () => {
  const side = 1024, offset = 2 ** -24;
  const cell: UnitCell = [[side, 0, 0], [0, side, 0], [0, 0, side]];
  const atoms = [atom("Na", -offset, side - offset, 2 * side + offset), atom("Cl", -offset, side - offset, 2 * side + offset)];
  const before = structuredClone(atoms);
  const result = reduceNiggliCell(niggli, { cell, atoms });
  expect(atoms).toEqual(before);
  expect(result.atoms!.latticeShifts).toEqual([[-1, 0, 2], [-1, 0, 2]]);
  expect(result.atoms!.wrappedAtoms.map(({ element }) => element)).toEqual(["Na", "Cl"]);
  for (let i = 0; i < atoms.length; i++) {
    const wrapped = result.atoms!.wrappedAtoms[i];
    const restored = [wrapped.x - side, wrapped.y, wrapped.z + 2 * side];
    expect(restored).toEqual([atoms[i].x, atoms[i].y, atoms[i].z]);
  }
});

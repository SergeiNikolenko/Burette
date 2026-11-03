import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { analyzeCrystalSymmetry, standardizeCrystal, SYMMETRY_TOLERANCE, type CrystalSites, type MoyoAnalyzer } from "../apps/desktop/src/lib/molecular-workbench/crystal-symmetry";
import { readCrystalDocument as readCrystalSites, type CrystalSource } from "../apps/desktop/src/lib/molecular-workbench/crystal-io";
import { runCrystalRequest } from "../apps/desktop/src/lib/molecular-workbench/crystal-symmetry-io";
import { readCifCrystal } from "../apps/desktop/src/lib/molecular-workbench/cif-crystal";

// The real moyo 0.21.0 WebAssembly module, as the crystal worker runs it.
const MOYO = new URL("../apps/desktop/node_modules/@spglib/moyo-wasm/", import.meta.url);
const moyo = await import(new URL("moyo_wasm.js", MOYO).href);
moyo.initSync({ module: readFileSync(new URL("moyo_wasm_bg.wasm", MOYO)) });
const finder: MoyoAnalyzer = { analyze_cell: moyo.analyze_cell, operations_from_number: moyo.operations_from_number, hall_symbol_entry: moyo.hall_symbol_entry };
const engines = { moyo: async () => finder, niggli: async () => { throw new Error("Niggli is not used here."); } };
const fixture = (name: string) => readFileSync(new URL(`fixtures/crystal-symmetry/${name}`, import.meta.url), "utf8");
const source = (name: string): CrystalSource => ({ format: name.endsWith(".xyz") ? "xyz" : "cif", text: fixture(name) });

// Independent linear algebra for checking the finder's matrices (rows; lattice vectors as columns).
type M = number[][];
const fromFlat = (flat: number[]): M => [0, 1, 2].map((i) => [0, 1, 2].map((j) => flat[i + 3 * j]));
const columns = (vectors: number[][]): M => [0, 1, 2].map((i) => vectors.map((vector) => vector[i]));
const mul = (a: M, b: M): M => a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
const vec = (a: M, v: number[]) => a.map((row) => row.reduce((sum, value, k) => sum + value * v[k], 0));
const det = (m: M) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const solve = (a: M, b: number[]) => [0, 1, 2].map((i) => det(a.map((row, r) => row.map((value, c) => (c === i ? b[r] : value)))) / det(a));
const modDistance = (a: number[], b: number[]) => Math.max(...a.map((value, i) => { const d = value - b[i]; return Math.abs(d - Math.round(d)); }));

function cellOf(lattice: number[][], fractional: number[][], elements: string[], species = elements): CrystalSites {
  const atoms = fractional.map((f, i) => { const [x, y, z] = vec(columns(lattice), f); return { element: elements[i], x, y, z }; });
  return { atoms, cell: lattice as CrystalSites["cell"], species, labels: elements.map((element, i) => `${element}${i + 1}`) };
}
const FCC = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];
const shifted = (points: number[][], by: number[]) => points.map((point) => point.map((value, i) => (value + by[i]) % 1));
const cubic = (a: number) => [[a, 0, 0], [0, a, 0], [0, 0, a]];
const rockSalt = (a: number) => cellOf(cubic(a), [...FCC, ...shifted(FCC, [0.5, 0.5, 0.5])], [...FCC.map(() => "Na"), ...FCC.map(() => "Cl")]);
/** Each species' fractional positions, compared as sets modulo lattice translations. */
const sameSites = (a: number[][], b: number[][]) => a.length === b.length && a.every((point) => b.some((other) => modDistance(point, other) < 1e-6));

test("triclinic P1 stays P1, with every atom its own site and an honest P1 CIF", async () => {
  const sites = cellOf([[4.1, 0, 0], [0.7, 5.3, 0], [1.1, 0.4, 6.2]], [[0.11, 0.23, 0.37], [0.61, 0.19, 0.83], [0.29, 0.71, 0.53]], ["C", "N", "O"]);
  const analysis = analyzeCrystalSymmetry(finder, sites, SYMMETRY_TOLERANCE.default);
  expect([analysis.number, analysis.symbol, analysis.operationCount, analysis.siteCount, analysis.conventional.atomCount, analysis.primitive.atomCount]).toEqual([1, "P 1", 1, 3, 3, 3]);
  expect(analysis.conventional.volume).toBeCloseTo(Math.abs(det(columns(sites.cell))), 6);
  const cif = await standardizeCrystal(finder, sites, SYMMETRY_TOLERANCE.default, "conventional", { title: "p1", readCif: readCifCrystal });
  expect(cif.cif).toContain("_space_group_IT_number 1\n");
  expect(cif.cif).toContain("_space_group_name_H-M_alt 'P 1'");
  expect((await readCifCrystal(cif.cif)).atoms).toHaveLength(3);
});

test("rock salt listed in P1 is Fm-3m (225): sites, cells, refined CIF and its reparse", async () => {
  const analysis = (await runCrystalRequest(engines, { action: "analyze", source: source("nacl-p1.cif"), tolerance: 0.01 })) as Awaited<ReturnType<typeof analyzeCrystalSymmetry>>;
  expect({ number: analysis.number, symbol: analysis.symbol, system: analysis.crystalSystem, pearson: analysis.pearson, operations: analysis.operationCount }).toEqual({ number: 225, symbol: "F m -3 m", system: "cubic", pearson: "cF8", operations: 192 });
  // Charged type symbols are the species; the four Na and four Cl atoms are one site each.
  expect(analysis.sites).toEqual([
    { label: "Na1", species: "Na1+", wyckoff: "4a", siteSymmetry: "m-3m", count: 4 },
    { label: "Cl1", species: "Cl1-", wyckoff: "4b", siteSymmetry: "m-3m", count: 4 },
  ]);
  const a = 5.6402;
  expect([analysis.conventional.atomCount, analysis.primitive.atomCount]).toEqual([8, 2]);
  expect(analysis.conventional.volume).toBeCloseTo(a ** 3, 6);
  expect(analysis.primitive.volume).toBeCloseTo(a ** 3 / 4, 6);
  expect(analysis.primitive.parameters.alpha).toBeCloseTo(60, 9);
  expect(analysis.maxShift).toBeLessThan(1e-9);

  const conventional = await standardizeCrystal(finder, await readCrystalSites(source("nacl-p1.cif")), 0.01, "conventional", { title: "nacl", readCif: readCifCrystal, expectedNumber: 225 });
  expect(conventional.cif).toMatch(/_space_group_IT_number 225\n_space_group_name_H-M_alt 'F m -3 m'\n/u);
  expect(conventional.cif.match(/^\d+ '[^']+'$/gmu)).toHaveLength(192);
  expect(conventional.cif).toMatch(/^Na1 Na1\+ 4 a 0\.0+ 0\.0+ 0\.0+ 1$/mu);
  expect(conventional.cif).toMatch(/^Cl1 Cl1- 4 b 0\.50+ 0\.50+ 0\.50+ 1$/mu);
  expect([conventional.atomCount, conventional.siteCount, conventional.labelsFromSource]).toEqual([8, 2, true]);
  // Reading the CIF back expands two sites into the full cell, and it is the same rock salt.
  const reread = await readCifCrystal(conventional.cif);
  const toFractional = (atom: { x: number; y: number; z: number }) => solve(columns(reread.cell), [atom.x, atom.y, atom.z]);
  const of = (element: string) => reread.atoms.filter((atom) => atom.element === element).map(toFractional);
  expect(sameSites(of("Na"), FCC) && sameSites(of("Cl"), shifted(FCC, [0.5, 0.5, 0.5]))).toBe(true);
  const again = await runCrystalRequest(engines, { action: "analyze", source: { format: "cif", text: conventional.cif }, tolerance: 0.001 });
  expect([again.number, (again as typeof analysis).sites.map((site) => site.species)]).toEqual([225, ["Na1+", "Cl1-"]]);

  const primitive = await standardizeCrystal(finder, await readCrystalSites(source("nacl-p1.cif")), 0.01, "primitive", { title: "nacl", readCif: readCifCrystal });
  // A primitive cell of a centred group is not in the setting the H-M symbol names.
  expect(primitive.cif).not.toContain("_space_group_name_H-M_alt");
  expect(primitive.cif).toContain("_space_group_IT_number 225\n");
  expect(primitive.cif.match(/^\d+ '[^']+'$/gmu)).toHaveLength(48);
  expect((await readCifCrystal(primitive.cif)).atoms).toHaveLength(2);
});

test("diamond in a skewed, rotated primitive basis is Fd-3m (227); the finder's transforms hold both ways", async () => {
  const sites = await readCrystalSites(source("diamond-skew-rotated.xyz"));
  const analysis = analyzeCrystalSymmetry(finder, sites, 0.01);
  const a = 3.567;
  expect([analysis.number, analysis.operationCount, analysis.conventional.atomCount, analysis.primitive.atomCount]).toEqual([227, 48, 8, 2]);
  expect(analysis.sites).toEqual([{ label: "C1", species: "C", wyckoff: "8a", siteSymmetry: "-43m", count: 2 }]);
  expect(analysis.conventional.volume).toBeCloseTo(a ** 3, 6);
  expect(analysis.primitive.volume).toBeCloseTo(a ** 3 / 4, 6);

  // Column-major conventions, checked with this file's own algebra on the raw dataset.
  const A = columns(sites.cell);
  const input = sites.atoms.map((atom) => solve(A, [atom.x, atom.y, atom.z]));
  const raw = moyo.analyze_cell(JSON.stringify({ lattice: { basis: sites.cell.flat() }, positions: input, numbers: [6, 6] }), 0.01, "Spglib");
  const L = fromFlat(raw.std_linear), R = fromFlat(raw.std_rotation_matrix), S = fromFlat(raw.std_cell.lattice.basis);
  expect(det(L)).toBeCloseTo(4, 9);
  expect(mul(R, mul(A, L)).flat().map((value, i) => value - S.flat()[i]).every((value) => Math.abs(value) < 1e-9)).toBe(true);
  // Forward: x_std = L^-1 (x_in - shift) lands on standardized atoms; backward: L x_std + shift on input atoms.
  for (const point of input) expect(raw.std_cell.positions.some((std: number[]) => modDistance(solve(L, point.map((value, i) => value - raw.std_origin_shift[i])), std) < 1e-9)).toBe(true);
  for (const std of raw.std_cell.positions) expect(input.some((point) => modDistance(vec(L, std).map((value, i) => value + raw.std_origin_shift[i]), point) < 1e-9)).toBe(true);

  const conventional = await standardizeCrystal(finder, sites, 0.01, "conventional", { title: "diamond", readCif: readCifCrystal });
  expect(conventional.cif).toContain("_space_group_name_H-M_alt 'F d -3 m'");
  expect(conventional.parameters.a).toBeCloseTo(a, 9);
  expect((await readCifCrystal(conventional.cif)).atoms).toHaveLength(8);
});

test("a left-handed basis keeps the enantiomorph; a mirror image gives the other one", async () => {
  const left = await readCrystalSites(source("quartz-left-handed.xyz"));
  expect(det(columns(left.cell))).toBeLessThan(0);
  const analysis = analyzeCrystalSymmetry(finder, left, 0.01);
  expect([analysis.number, analysis.symbol, analysis.siteCount]).toEqual([154, "P 3_2 2 1", 2]);
  expect(analysis.sites.map((site) => site.wyckoff)).toEqual(["3a", "6c"]);
  const raw = moyo.analyze_cell(JSON.stringify({ lattice: { basis: left.cell.flat() }, positions: left.atoms.map((atom) => solve(columns(left.cell), [atom.x, atom.y, atom.z])), numbers: left.atoms.map((atom) => (atom.element === "Si" ? 14 : 8)) }), 0.01, "Spglib");
  expect(det(fromFlat(raw.std_linear))).toBeLessThan(0);
  expect(det(fromFlat(raw.std_cell.lattice.basis))).toBeGreaterThan(0);

  // Reflecting the atoms through a plane, with the same basis, is the other quartz.
  const mirrored = { ...left, atoms: left.atoms.map((atom) => ({ ...atom, z: -atom.z })), cell: left.cell.map(([x, y, z]) => [x, y, -z]) as CrystalSites["cell"] };
  expect(analyzeCrystalSymmetry(finder, mirrored, 0.01).number).toBe(152);

  // The written right-handed cell is still P3_221: the output is rotated, never reflected.
  const conventional = await standardizeCrystal(finder, left, 0.01, "conventional", { title: "quartz", readCif: readCifCrystal });
  expect(conventional.atomCount).toBe(9);
  expect((await runCrystalRequest(engines, { action: "analyze", source: { format: "cif", text: conventional.cif }, tolerance: 0.01 })).number).toBe(154);
});

test("charged species stay distinct: Fe2+/Fe3+ is primitive cubic, a single Fe species would be body-centred", async () => {
  const mixed = await readCrystalSites(source("iron-mixed-valence.cif"));
  expect(mixed.species).toEqual(["Fe2+", "Fe3+"]);
  expect(analyzeCrystalSymmetry(finder, mixed, 0.01).number).toBe(221);
  expect(analyzeCrystalSymmetry(finder, { ...mixed, species: ["Fe", "Fe"] }, 0.01).number).toBe(229);
  const cif = await standardizeCrystal(finder, mixed, 0.01, "conventional", { title: "iron", readCif: readCifCrystal });
  expect(cif.cif).toMatch(/^Fe1 Fe2\+ /mu);
  expect(cif.cif).toMatch(/^Fe2 Fe3\+ /mu);
});

test("noise within the tolerance refines onto exact positions; a tighter tolerance sees lower symmetry", async () => {
  const exact = rockSalt(5.64);
  const jitter = [[0.003, -0.002, 0.001], [-0.002, 0.002, 0.0], [0.001, 0.0, -0.003], [0.0, 0.003, 0.002]];
  const noisy = { ...exact, atoms: exact.atoms.map((atom, i) => ({ ...atom, x: atom.x + jitter[i % 4][0], y: atom.y + jitter[i % 4][1], z: atom.z + jitter[i % 4][2] })) };
  const loose = analyzeCrystalSymmetry(finder, noisy, 0.01);
  expect(loose.number).toBe(225);
  expect(loose.maxShift!).toBeGreaterThan(1e-3);
  expect(loose.maxShift!).toBeLessThan(0.01);
  expect(analyzeCrystalSymmetry(finder, noisy, 0.0005).number).toBeLessThan(225);
  // The written cell is the refined one: exact special positions.
  const refined = await standardizeCrystal(finder, noisy, 0.01, "conventional", { title: "noisy", readCif: readCifCrystal });
  expect(refined.cif).toMatch(/^Na1 Na 4 a 0\.0+ 0\.0+ 0\.0+ 1$/mu);
});

test("a 2x2x2 supercell keeps its lattice translations as operations and reduces to the same cells", () => {
  const unit = rockSalt(5.64);
  const fractional: number[][] = [], elements: string[] = [];
  for (const [i, j, k] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) {
    unit.atoms.forEach((atom) => { fractional.push(solve(columns(unit.cell), [atom.x, atom.y, atom.z]).map((value, axis) => (value + [i, j, k][axis]) / 2)); elements.push(atom.element); });
  }
  const analysis = analyzeCrystalSymmetry(finder, cellOf(cubic(11.28), fractional, elements), 0.01);
  expect([analysis.number, analysis.operationCount, analysis.conventional.atomCount, analysis.primitive.atomCount]).toEqual([225, 192 * 8, 8, 2]);
  expect(analysis.sites.map((site) => [site.wyckoff, site.count])).toEqual([["4a", 32], ["4b", 32]]);
});

test("invalid tolerance, duplicates, close atoms, oversize cells, bad cells and disorder are refused before the finder", async () => {
  const salt = rockSalt(5.64);
  for (const tolerance of [0, Number.NaN, -0.01, 0.6, Infinity]) expect(() => analyzeCrystalSymmetry(finder, salt, tolerance)).toThrow("The tolerance must be between 0.0001 and 0.5 Å.");
  const duplicate = { ...salt, atoms: [...salt.atoms, { element: "Na", x: 5.64, y: 0, z: 0 }], species: [...salt.species, "Na"], labels: [...salt.labels, "Na9"] };
  expect(() => analyzeCrystalSymmetry(finder, duplicate, 0.01)).toThrow("Atoms Na1 and Na9 occupy the same site of the periodic cell. Remove the duplicate.");
  const crowded = { ...salt, atoms: [...salt.atoms, { element: "Cl", x: 0.005, y: 0, z: 0 }], species: [...salt.species, "Cl"], labels: [...salt.labels, "Cl9"] };
  expect(() => analyzeCrystalSymmetry(finder, crowded, 0.01)).toThrow("Atoms Na1 and Cl9 are 0.0050 Å apart, within the tolerance.");
  const big = Array.from({ length: 5001 }, (_, i) => [((i * 7) % 5001) / 5001, ((i * 13) % 5001) / 5001, i / 5001]);
  expect(() => analyzeCrystalSymmetry(finder, cellOf(cubic(400), big, big.map(() => "C")), 0.01)).toThrow("Symmetry analysis supports up to 5,000 atoms per cell.");
  expect(() => analyzeCrystalSymmetry(finder, { ...salt, cell: [[5, 0, 0], [0, 5, 0], [5, 5, 0]] }, 0.01)).toThrow("The cell vectors are nearly coplanar.");
  expect(() => analyzeCrystalSymmetry(finder, { ...salt, cell: [[5, 0, 0], [0, Number.NaN, 0], [0, 0, 5]] }, 0.01)).toThrow("The cell vectors must be finite.");
  expect(() => analyzeCrystalSymmetry(finder, { ...salt, atoms: salt.atoms.map((atom, i) => (i ? atom : { ...atom, x: Infinity })) }, 0.01)).toThrow("Atom coordinates must be finite.");
  expect(() => analyzeCrystalSymmetry(finder, { ...salt, species: salt.species.map((value, i) => (i ? value : "D")) }, 0.01)).toThrow("Atom Na1 has an unsupported species D.");
  await expect(readCrystalSites(source("nacl-partial-occupancy.cif"))).rejects.toThrow("Resolve partially occupied or disordered CIF sites before building a supercell.");
  await expect(readCrystalSites({ format: "xyz", text: "1\nplain molecule\nC 0 0 0\n" })).rejects.toThrow("This XYZ file has no Lattice in its comment line, so it has no unit cell.");
  await expect(readCrystalSites({ format: "xyz", text: "1\nLattice=\"3 0 0 0 3 0 0 0 3\"\nC 0 0 0\n1\nf2\nC 0 0 0\n" })).rejects.toThrow("Crystal tools need one XYZ frame of element symbols and coordinates.");
});

test("finder output is checked: tampered operations, cells and symbols are rejected", () => {
  const salt = rockSalt(5.64);
  const tampered = (change: (data: any) => void): MoyoAnalyzer => ({ ...finder, analyze_cell: (...args) => { const data = moyo.analyze_cell(...args); change(data); return data; } });
  const cases: [(data: any) => void, string][] = [
    [(data) => { data.operations[5].translation = [0.25, 0, 0]; }, "A reported symmetry operation does not map the structure onto itself. Try a smaller tolerance."],
    [(data) => { data.operations[3].rotation = [2, 0, 0, 0, 1, 0, 0, 0, 1]; }, "The symmetry finder returned an invalid rotation."],
    [(data) => { data.number = 231; }, "The symmetry finder returned an invalid space-group number."],
    [(data) => { data.std_cell.positions.pop(); data.std_cell.numbers.pop(); }, "The symmetry finder returned an invalid standard cell size."],
    [(data) => { data.std_cell.lattice.basis[8] *= -1; }, "The symmetry finder returned an invalid standard cell handedness."],
    [(data) => { data.std_cell.numbers[0] = 9; }, "The symmetry finder returned an invalid standard cell species."],
    [(data) => { data.orbits[1] = 2; }, "The symmetry finder returned an invalid orbit list."],
    [(data) => { data.std_rotation_matrix = [1, 0, 0, 0, 1, 0, 0, 0, -1]; }, "The symmetry finder returned an invalid rotation matrix."],
    [(data) => { data.hm_symbol = "<script>"; }, "The symmetry finder returned an invalid space-group symbol."],
  ];
  for (const [change, message] of cases) expect(() => analyzeCrystalSymmetry(tampered(change), salt, 0.01)).toThrow(message);
  expect(() => analyzeCrystalSymmetry({ ...finder, analyze_cell: () => { throw "moyo error: PrimitiveSymmetrySearchError"; } }, salt, 0.01)).toThrow("No consistent space group was found at this tolerance. Try another tolerance.");
});

test("a standardization of changed text is refused when it no longer matches the analysis shown", async () => {
  await expect(standardizeCrystal(finder, rockSalt(5.64), 0.01, "conventional", { title: "nacl", readCif: readCifCrystal, expectedNumber: 221 })).rejects.toThrow("The structure changed since it was analysed.");
});

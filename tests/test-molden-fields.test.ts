import { expect, test } from "bun:test";
import { parseMolden, evaluateOrbital, evaluateDensity, evaluateSpinDensity, evaluateOrbitalGrid, evaluateDensityGrid, evaluateSpinDensityGrid } from "../apps/desktop/src/lib/molecular-workbench/gaussian";
const BOHR = 0.529177210903, norm = (2 / Math.PI) ** 0.75;
// Minimal analytic fixture from the existing workbench quantum tests, not a calculation output.
const hydrogen = `[Molden Format]
[Atoms] AU
H 1 1 0 0 0
[GTO]
1 0
s 1 1.00
1.0D+00 1.0
[MO]
Sym= A
Ene= -0.5
Spin= Alpha
Occup= 1
1 1.0
Sym= B
Ene= 0.25
Spin= Beta
Occup= 0
1 -1.0
`;
const orbital = (shell: "p" | "d", index: number, flag = "") => parseMolden(`[Molden Format]\n[Atoms] Angs\nH 1 1 0 0 0\n${flag}[GTO]\n1 0\n${shell} 1 1\n1 1\n[MO]\nEne=0\nSpin=Alpha\nOccup=0\n${index} 1\n`);

test("Molden retains spin/orbital metadata, AU/angstrom centers and normalized orbital amplitudes", () => {
  const result = parseMolden(hydrogen);
  expect(result.orbitals.map(({ energyHartree, occupancy, spin }) => ({ energyHartree, occupancy, spin }))).toEqual([{ energyHartree: -0.5, occupancy: 1, spin: "alpha" }, { energyHartree: 0.25, occupancy: 0, spin: "beta" }]);
  expect(result.frames[0].atoms).toBe(result.atoms);
  expect(evaluateOrbital(result, 0, [0, 0, 0])).toBeCloseTo(norm, 12); expect(evaluateOrbital(result, 1, [0, 0, 0])).toBeCloseTo(-norm, 12);
  expect(evaluateOrbital(result, 0, [BOHR, 0, 0])).toBeCloseTo(norm / Math.E, 12);
  const moved = parseMolden(hydrogen.replace("H 1 1 0 0 0", "H 1 1 0 0 1"));
  expect(moved.atoms[0].z).toBe(BOHR); expect(evaluateOrbital(moved, 0, [0, 0, BOHR])).toBeCloseTo(norm, 12);
  expect(parseMolden(hydrogen.replace("[Atoms] AU", "[Atoms] Angs").replace("H 1 1 0 0 0", "H 1 1 0 0 1")).atoms[0].z).toBe(1);
});

test("Molden p/d and 5D component order matches analytic Cartesian and spherical functions, including z-fast grids", () => {
  const px = orbital("p", 1), xy = orbital("d", 4), dz2 = orbital("d", 1, "[5D]\n");
  expect(evaluateOrbital(px, 0, [BOHR, 0, 0])).toBeCloseTo(2 * norm / Math.E, 12); expect(evaluateOrbital(px, 0, [0, BOHR, 0])).toBe(0);
  expect(evaluateOrbital(xy, 0, [BOHR, BOHR, 0])).toBeCloseTo(4 * norm * Math.exp(-2), 12);
  expect(evaluateOrbital(dz2, 0, [0, 0, BOHR])).toBeCloseTo(4 * norm / Math.sqrt(3) / Math.E, 12);
  expect(evaluateOrbital(dz2, 0, [BOHR, 0, 0])).toBeCloseTo(-2 * norm / Math.sqrt(3) / Math.E, 12);
  const grid = evaluateOrbitalGrid(px, 0, { spacingAngstrom: 0.5, paddingAngstrom: 1 });
  expect({ dimensions: grid.dimensions, origin: grid.origin, axes: grid.axes }).toEqual({ dimensions: [5, 5, 5], origin: [-1, -1, -1], axes: [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]] });
  expect(grid.values[87]).toBeCloseTo(2 * 0.5 / BOHR * norm * Math.exp(-((0.5 / BOHR) ** 2)), 6); expect(grid.values[63]).toBe(0);
});

test("Molden mixed spherical flags and sp contractions retain independent shell conventions and coefficients", () => {
  for (const [flag, spherical, count] of [["[5D]", [true, true], 12], ["[5D10F]", [true, false], 15], ["[7F]", [false, true], 13]] as const) {
    const source = hydrogen.replace("[GTO]", `${flag}\n[GTO]`).replace("s 1 1.00\n1.0D+00 1.0", "d 1 1\n1 1\nf 1 1\n1 1");
    const result = parseMolden(source); expect(result.basis!.map(shell => shell.spherical)).toEqual([...spherical]); expect(result.orbitals[0].coefficients).toHaveLength(count);
  }
  const sp = parseMolden(hydrogen.replace("s 1 1.00\n1.0D+00 1.0", "sp 1 1\n1 0.2 0.3").replace("1 1.0\nSym", "2 1.0\nSym"));
  expect(sp.basis!.map(shell => [shell.kind, shell.coefficients])).toEqual([["s", [0.2]], ["p", [0.3]]]);
  expect(evaluateOrbital(sp, 0, [BOHR, 0, 0])).toBeCloseTo(0.3 * 2 * norm / Math.E, 12);
});

test("density and spin-density preserve occupations, restricted pairing, electron units and grid normalization", () => {
  const result = parseMolden(hydrogen), square = norm ** 2;
  expect(evaluateDensity(result, [0, 0, 0])).toBeCloseTo(square, 12); expect(evaluateSpinDensity(result, [0, 0, 0])).toBeCloseTo(square, 12);
  result.orbitals[0].occupancy = 0.75; result.orbitals[1].occupancy = 0.25;
  expect(evaluateDensity(result, [0, 0, 0])).toBeCloseTo(square, 12); expect(evaluateSpinDensity(result, [0, 0, 0])).toBeCloseTo(0.5 * square, 12);
  result.orbitals[1].occupancy = 1; expect(evaluateSpinDensity(result, [0, 0, 0])).toBeCloseTo(-0.25 * square, 12);
  result.orbitals = [result.orbitals[0]]; result.orbitals[0].occupancy = 2;
  const grid = evaluateDensityGrid(result, { paddingAngstrom: 2.5, spacingAngstrom: 0.15 });
  expect(grid.values.reduce((sum, value) => sum + value, 0) * (0.15 / BOHR) ** 3).toBeCloseTo(2, 5);
  expect(evaluateSpinDensityGrid(result, { paddingAngstrom: 0.5, spacingAngstrom: 0.5 }).values.every(value => value === 0)).toBe(true);
  result.orbitals[0].occupancy = 1.5; expect(() => evaluateSpinDensity(result, [0, 0, 0])).toThrow("spin partition");
});

test("Molden parser and field limits reject inconsistent metadata, unsupported bases and oversized work", () => {
  for (const invalid of [hydrogen.replace("s 1 1.00", "h 1 1.00"), hydrogen.replace("1 1.0\nSym", "2 1.0\nSym"), hydrogen.replace("1.0D+00", "-1.0"), hydrogen.replace("H 1 1", "H 2 1"), hydrogen.replace("H 1 1", "H 1 2"), hydrogen.replace("[Atoms] AU", "[Atoms] invalid"), hydrogen.replace("Spin= Alpha", "Spin= invalid"), hydrogen.replace("Occup= 1", "Occup= 3"), "x".repeat(16 * 1024 * 1024 + 1)]) expect(() => parseMolden(invalid)).toThrow();
  const result = parseMolden(hydrogen); expect(() => evaluateOrbitalGrid(result, 0, { spacingAngstrom: 0.1, paddingAngstrom: 10 })).toThrow("limit");
  result.orbitals = Array.from({ length: 200 }, (_, index) => ({ ...result.orbitals[0], index })); expect(() => evaluateDensityGrid(result, { spacingAngstrom: 0.1, paddingAngstrom: 3 })).toThrow("work limit");
  result.basis![0].exponents = Array(100).fill(1); result.basis![0].coefficients = Array(100).fill(1);
  result.orbitals = Array.from({ length: 3000 }, (_, index) => ({ ...result.orbitals[0], index })); expect(() => evaluateDensityGrid(result, { spacingAngstrom: 1, paddingAngstrom: 1 })).toThrow("memory limit");
});

test("Gaussian browser closure retains the field evaluator without quantum dispatcher, client or workers", async () => {
  const loaded: string[] = [], built = await Bun.build({ entrypoints: [new URL("../apps/desktop/src/lib/molecular-workbench/gaussian.ts", import.meta.url).pathname], target: "browser", plugins: [{ name: "gaussian-closure", setup(build) { build.onLoad({ filter: /\.[cm]?[jt]sx?$/u }, ({ path }) => { loaded.push(path); }); } }] });
  expect(built.success).toBe(true); expect(loaded.some(path => path.endsWith("/gaussian-angular.ts"))).toBe(true);
  expect(loaded.filter(path => /\/(?:quantum|quantum-client|science-worker|science-task)\.[cm]?[jt]s$/u.test(path))).toEqual([]);
});

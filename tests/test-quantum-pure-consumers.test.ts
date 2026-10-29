import {expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {BOHR_ANGSTROM,parseScientificFile} from "../apps/desktop/src/lib/molecular-workbench/quantum";
import {evaluateDensity,evaluateDensityGrid,evaluateOrbital,evaluateSpinDensity,evaluateSpinDensityGrid} from "../apps/desktop/src/lib/molecular-workbench/gaussian";
const hydrogenMolden=readFileSync(new URL("./fixtures/quantum/dispatcher/hydrogen.molden",import.meta.url),"utf8");

test("Molden s orbital matches the normalized Gaussian reference and spin metadata", () => {
  const document = parseScientificFile("h.molden", hydrogenMolden);
  expect(document.orbitals.map(({ energyHartree, occupancy, spin }) => ({ energyHartree, occupancy, spin }))).toEqual([
    { energyHartree: -0.5, occupancy: 1, spin: "alpha" }, { energyHartree: 0.25, occupancy: 0, spin: "beta" },
  ]);
  const normalization = Math.pow(2 / Math.PI, 0.75);
  expect(evaluateOrbital(document, 0, [0, 0, 0])).toBeCloseTo(normalization, 12);
  expect(evaluateOrbital(document, 0, [BOHR_ANGSTROM, 0, 0])).toBeCloseTo(normalization / Math.E, 12);
  expect(evaluateOrbital(document, 1, [0, 0, 0])).toBeCloseTo(-normalization, 12);
});

test("Molden p and d shell ordering, normalization and 5D real harmonics", () => {
  function orbital(shell: "p" | "d", basisIndex: number, spherical = false) {
    return parseScientificFile("test.molden", `[Molden Format]\n[Atoms] Angs\nH 1 1 0 0 0\n${spherical ? "[5D]\n" : ""}[GTO]\n1 0\n${shell} 1 1\n1 1\n[MO]\nEne=0\nSpin=Alpha\nOccup=0\n${basisIndex} 1\n`);
  }
  const n = Math.pow(2 / Math.PI, 0.75);
  const px = orbital("p", 1);
  expect(evaluateOrbital(px, 0, [BOHR_ANGSTROM, 0, 0])).toBeCloseTo(2 * n / Math.E, 12);
  expect(evaluateOrbital(px, 0, [0, BOHR_ANGSTROM, 0])).toBe(0);
  const xy = orbital("d", 4);
  expect(evaluateOrbital(xy, 0, [BOHR_ANGSTROM, BOHR_ANGSTROM, 0])).toBeCloseTo(4 * n * Math.exp(-2), 12);
  const dz2 = orbital("d", 1, true);
  expect(evaluateOrbital(dz2, 0, [0, 0, BOHR_ANGSTROM])).toBeCloseTo(4 * n / Math.sqrt(3) / Math.E, 12);
  expect(evaluateOrbital(dz2, 0, [BOHR_ANGSTROM, 0, 0])).toBeCloseTo(-2 * n / Math.sqrt(3) / Math.E, 12);
});

test("Density uses orbital occupancy while spin-density uses signed alpha/beta occupancy", () => {
  const document = parseScientificFile("h.molden", hydrogenMolden);
  const psiSquared = Math.pow(2 / Math.PI, 1.5);
  expect(evaluateDensity(document, [0, 0, 0])).toBeCloseTo(psiSquared, 12);
  expect(evaluateSpinDensity(document, [0, 0, 0])).toBeCloseTo(psiSquared, 12);
  document.orbitals[0].occupancy = 0.75;
  document.orbitals[1].occupancy = 0.25;
  expect(evaluateDensity(document, [0, 0, 0])).toBeCloseTo(psiSquared, 12);
  expect(evaluateSpinDensity(document, [0, 0, 0])).toBeCloseTo(0.5 * psiSquared, 12);
  document.orbitals[1].occupancy = 1;
  expect(evaluateSpinDensity(document, [0, 0, 0])).toBeCloseTo(-0.25 * psiSquared, 12);
});

test("Restricted doubly occupied Gaussian integrates to two electrons with zero spin", () => {
  const document = parseScientificFile("he.molden", hydrogenMolden);
  document.orbitals = [document.orbitals[0]];
  document.orbitals[0].occupancy = 2;
  expect(evaluateDensity(document, [0, 0, 0])).toBeCloseTo(2 * Math.pow(2 / Math.PI, 1.5), 12);
  expect(evaluateSpinDensity(document, [0, 0, 0])).toBe(0);
  const grid = evaluateDensityGrid(document, { paddingAngstrom: 2.5, spacingAngstrom: 0.15 });
  const integral = grid.values.reduce((sum, value) => sum + value, 0) * Math.pow(0.15 / BOHR_ANGSTROM, 3);
  expect(integral).toBeCloseTo(2, 5);
  const spin = evaluateSpinDensityGrid(document, { paddingAngstrom: 0.5, spacingAngstrom: 0.5 });
  expect(spin.values.every(value => value === 0)).toBe(true);
  document.orbitals[0].occupancy = 1;
  expect(evaluateSpinDensity(document, [0, 0, 0])).toBeCloseTo(Math.pow(2 / Math.PI, 1.5), 12);
  document.orbitals[0].occupancy = 1.5;
  expect(() => evaluateSpinDensity(document, [0, 0, 0])).toThrow("spin partition");
});

test("Quantum grid work is bounded by occupied coefficients times grid points", () => {
  const document = parseScientificFile("h.molden", hydrogenMolden);
  document.orbitals = Array.from({ length: 200 }, (_, index) => ({ ...document.orbitals[0], index }));
  expect(() => evaluateDensityGrid(document, { spacingAngstrom: 0.1, paddingAngstrom: 3 })).toThrow("work limit");
  document.basis![0].exponents = Array(100).fill(1);
  document.basis![0].coefficients = Array(100).fill(1);
  document.orbitals = Array.from({ length: 3_000 }, (_, index) => ({ ...document.orbitals[0], index }));
  expect(() => evaluateDensityGrid(document, { spacingAngstrom: 1, paddingAngstrom: 1 })).toThrow("memory limit");
});

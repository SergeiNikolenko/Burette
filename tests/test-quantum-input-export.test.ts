import { expect, test } from "bun:test";
import { generateQuantumInput } from "../apps/desktop/src/lib/molecular-workbench/input-export";
import type { MolecularAtom } from "../apps/desktop/src/lib/molecular-workbench/types";
const water: MolecularAtom[] = [{ element: "O", x: 0, y: 0, z: 0 }, { element: "H", x: 0.9572, y: 0, z: 0 }, { element: "H", x: -0.24, y: 0.927, z: 0 }];

test("quantum exports enforce spin and index conventions and reject input injection", () => {
  const base = { charge: 0, multiplicity: 1, method: "B3LYP", basis: "def2-SVP", task: "optimize" as const, constraints: [{ kind: "freeze" as const, atoms: [0] }, { kind: "distance" as const, atoms: [0, 1] }] };
  const orca = generateQuantumInput(water, { ...base, engine: "orca" });
  expect(orca.text).toContain("{ C 0 C }");
  expect(orca.text).toContain("{ B 0 1 C }");
  expect(orca.text).toContain("* xyz 0 1");
  const gaussian = generateQuantumInput(water, { ...base, engine: "gaussian" });
  expect(gaussian.text).toContain("Opt=ModRedundant");
  expect(gaussian.text).toContain("X 1 F\nB 1 2 F");
  const psi = generateQuantumInput(water, { ...base, engine: "psi4" });
  expect(psi.text).toContain('frozen_cartesian = "1 xyz"');
  expect(psi.text).toContain('frozen_distance = "1 2"');
  expect(psi.text).toContain("optimize('B3LYP')");
  expect(() => generateQuantumInput(water, { ...base, engine: "orca", multiplicity: 2 })).toThrow("electron count");
  expect(() => generateQuantumInput(water, { ...base, engine: "psi4", method: "hf');import os" })).toThrow("keywords");
  expect(() => generateQuantumInput(water, { ...base, engine: "orca", constraints: [{ kind: "freeze", atoms: [3] }] })).toThrow("indices");
});

test("CP2K emits a padded isolated box or the explicit periodic cell", () => {
  const base = { engine: "cp2k" as const, charge: 0, multiplicity: 1, method: "PBE", basis: "DZVP-MOLOPT-SR-GTH" };
  const isolated = generateQuantumInput(water, base).text;
  expect(isolated).toContain("PERIODIC NONE");
  expect(isolated).toContain("POTENTIAL GTH-PBE");
  expect(isolated).toContain("O 6.24000000 6.00000000 6.00000000");
  expect(isolated).toContain("POISSON_SOLVER WAVELET");
  const periodic = generateQuantumInput(water, { ...base, cell: [[10, 0, 0], [3, 10, 0], [0, 0, 10]] }).text;
  expect(periodic).toContain("B 3.00000000 10.00000000 0.00000000");
  expect(periodic).toContain("PERIODIC XYZ");
  expect(() => generateQuantumInput(water, { ...base, task: "optimize", constraints: [{ kind: "distance", atoms: [0, 1] }] })).toThrow("frozen atoms only");
});

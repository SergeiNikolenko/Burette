import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

const { atomsFromZmatrixDocument, parseZmatrixDocument } = await import("../scripts/zmatrix-document.mjs");
const { readPdbAtoms } = await import("../apps/desktop/src/lib/workbench/structure");
const ethanol: MolecularAtom[] = readFileSync(new URL("./fixtures/automation/ethanol-ensemble.sdf", import.meta.url), "utf8").split("M  V30 END ATOM")[0]
  .split("\n").filter(line => /^M {2}V30 \d+ [A-Z]/u.test(line)).map(line => { const [, , , element, x, y, z] = line.split(/\s+/u); return { element, x: +x, y: +y, z: +z }; });
const distances = (atoms: { x: number; y: number; z: number }[]) => atoms.flatMap((a, i) => atoms.slice(0, i).map(b => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)));
/** The atoms a Z-matrix geometry block places, X rows dropped, as the programs read them. */
const placed = (block: string) => atomsFromZmatrixDocument(parseZmatrixDocument(block.replaceAll(/^DA\b/gmu, "X")))
  .map(atom => ({ element: atom.element, x: atom.position[0], y: atom.position[1], z: atom.position[2] }));
const sameShape = (back: MolecularAtom[], atoms: MolecularAtom[]) => {
  expect(back.map(atom => atom.element)).toEqual(atoms.map(atom => atom.element));
  distances(back).forEach((value, k) => expect(value).toBeCloseTo(distances(atoms)[k], 6));
};
const base = { charge: 0, multiplicity: 1, method: "B3LYP", basis: "def2-SVP" };

test("Z-matrix inputs place the same atoms in their own order for Gaussian, ORCA and Psi4; Cartesian ORCA keeps the coordinates", () => {
  expect(ethanol).toHaveLength(9);
  const gaussian = generateQuantumInput(ethanol, { ...base, engine: "gaussian", coordinates: "zmatrix", task: "optimize", constraints: [{ kind: "distance", atoms: [1, 2] }] }).text;
  // Route, title, then charge/multiplicity and the rows up to the blank line; ModRedundant numbers the same atoms.
  const [, , geometry, modredundant] = gaussian.split("\n\n");
  expect(geometry.split("\n")[0]).toBe("0 1");
  sameShape(placed(geometry.split("\n").slice(1).join("\n")), ethanol);
  expect(modredundant).toBe("B 2 3 F");
  const orca = generateQuantumInput(ethanol, { ...base, engine: "orca", coordinates: "zmatrix" }).text;
  sameShape(placed(orca.split("* gzmt 0 1\n")[1].split("\n*")[0]), ethanol);
  const psi4 = generateQuantumInput(ethanol, { ...base, engine: "psi4", coordinates: "zmatrix" }).text;
  sameShape(placed(psi4.split("0 1\n")[1].split("\nunits")[0]), ethanol);
  const cartesian = generateQuantumInput(ethanol, { ...base, engine: "orca", coordinates: "cartesian" }).text.split("* xyz 0 1\n")[1].split("\n*")[0].split("\n");
  expect(cartesian.map(line => { const [element, x, y, z] = line.split(" "); return { element, x: +x, y: +y, z: +z }; }))
    .toEqual(ethanol.map(atom => ({ element: atom.element, x: expect.closeTo(atom.x, 8), y: expect.closeTo(atom.y, 8), z: expect.closeTo(atom.z, 8) })));
  expect(() => generateQuantumInput(ethanol, { ...base, engine: "cp2k", method: "PBE", coordinates: "zmatrix" })).toThrow("Cartesian coordinates only");
});

test("a written definition keeps its shared variables where the program reads them, and a collinear start gets a dummy point", () => {
  const definition = parseZmatrixDocument("O\nH 1 R\nH 1 R 2 A\n\nR = 0.96\nA = 104.5\n");
  const water = atomsFromZmatrixDocument(definition).map(atom => ({ element: atom.element, x: atom.position[0], y: atom.position[1], z: atom.position[2] }));
  const gaussian = generateQuantumInput(water, { ...base, engine: "gaussian", coordinates: "zmatrix", definition }).text;
  expect(gaussian).toContain("0 1\nO\nH 1 R\nH 1 R 2 A\n\nR=0.96000000\nA=104.50000000\n\n");
  expect(generateQuantumInput(water, { ...base, engine: "psi4", coordinates: "zmatrix", definition }).text).toContain("H 1 R 2 A\nR = 0.96000000\nA = 104.50000000\nunits");
  expect(generateQuantumInput(water, { ...base, engine: "orca", coordinates: "zmatrix", definition }).text).toContain("H 1 0.96000000 2 104.50000000\n*");
  expect(() => generateQuantumInput(water.slice(0, 2), { ...base, engine: "gaussian", coordinates: "zmatrix", definition, charge: -1 })).toThrow("does not match");

  // The first three atoms on one line leave the fourth no dihedral plane.
  const co2: MolecularAtom[] = [{ element: "C", x: 0, y: 0, z: 0 }, { element: "C", x: 1.2, y: 0, z: 0 }, { element: "H", x: -1.06, y: 0, z: 0 }, { element: "H", x: 2, y: 1, z: 0 }];
  const linear = generateQuantumInput(co2, { ...base, engine: "gaussian", coordinates: "zmatrix" }).text.split("\n\n")[2];
  expect(linear.split("\n")[3]).toStartWith("X ");
  sameShape(placed(linear.split("\n").slice(1).join("\n")), co2);
  expect(generateQuantumInput(co2, { ...base, engine: "orca", coordinates: "zmatrix" }).text).toContain("\nDA ");
  expect(() => generateQuantumInput(co2, { ...base, engine: "gaussian", coordinates: "zmatrix", task: "optimize", constraints: [{ kind: "freeze", atoms: [0] }] })).toThrow("dummy point");
});

test("PDB atoms come from the first model and first alternate location, with elements from columns 77-78 or the atom name", () => {
  const pdb = [
    "HETATM    1  C1  LIG A   1       0.000   0.000   0.000  1.00  0.00           C",
    "HETATM    2 CL1  LIG A   1       1.750   0.000   0.000  1.00  0.00",
    "ATOM      3  CA AALA A   2       0.000   1.500   0.000  0.50  0.00           C",
    "ATOM      4  CA BALA A   2       0.000   1.600   0.000  0.50  0.00           C",
    "ATOM      5 1HB  ALA A   2       0.000   0.000   1.090  1.00  0.00",
    "ENDMDL",
    "ATOM      6  N   ALA A   3       9.000   9.000   9.000  1.00  0.00           N",
  ].join("\n");
  expect(readPdbAtoms(pdb)).toEqual([
    { element: "C", x: 0, y: 0, z: 0 }, { element: "Cl", x: 1.75, y: 0, z: 0 }, { element: "C", x: 0, y: 1.5, z: 0 }, { element: "H", x: 0, y: 0, z: 1.09 },
  ]);
  expect(() => readPdbAtoms("HEADER only\n")).toThrow("no atoms");
});

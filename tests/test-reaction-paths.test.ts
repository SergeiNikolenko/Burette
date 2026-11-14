import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";
import type { ReactionPath } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";

const read = (name: string) => parseScientificFile(name, readFileSync(new URL(`./fixtures/quantum/reaction-paths/${name}`, import.meta.url), "utf8"));
const close = (actual: number[], expected: number[], tolerance: number) => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThanOrEqual(tolerance));
};

test("a Gaussian ModRedundant scan gives each scan point's energy and bond length as the summary prints them", () => {
  const document = read("relaxed_PES_testCO2.log");
  const path = document.path!;
  expect([path.kind, path.axis]).toEqual(["scan", { kind: "bond", atoms: [0, 1] }]);
  // "Summary of Optimized Potential Surface Scan": Eigenvalues and R1 (the scanned B 1 2), five decimals.
  close(path.points.map((point) => point.energyHartree), [-187.49666, -187.49909, -187.49950, -187.49989, -187.50027, -187.50065, -187.50103, -187.50139, -187.50175, -187.50211, -187.50246], 5e-6);
  close(path.points.map((point) => point.x), [1.1, 1.101, 1.102, 1.103, 1.104, 1.105, 1.106, 1.107, 1.108, 1.109, 1.11], 5e-6);
  // MaxCycle=10 stopped the first scan points before they converged.
  expect(path.points.slice(0, 3).map((point) => point.converged)).toEqual([false, false, true]);
  // Each point is the last optimization step of its scan point, so its frame holds that geometry and energy.
  for (const point of path.points) expect(document.frames[point.frame!].energyHartree).toBe(point.energyHartree);
});

test("a Gaussian IRC opens as its path, ordered by the reaction coordinate in the summary", () => {
  const document = read("HCN-ts-irc.log");
  const path = document.path!;
  // "Summary of reaction path following": energy relative to the TS and RxCoord in amu^½·bohr.
  const summary: Array<[number, number]> = [[-0.01110, -0.80848], [-0.00966, -0.72763], [-0.00818, -0.64679], [-0.00668, -0.56595], [-0.00521, -0.48510],
    [-0.00381, -0.40425], [-0.00255, -0.32340], [-0.00149, -0.24255], [-0.00068, -0.16170], [-0.00017, -0.08085], [0, 0], [-0.00018, 0.08084], [-0.00072, 0.16169],
    [-0.00162, 0.24254], [-0.00285, 0.32339], [-0.00440, 0.40424], [-0.00624, 0.48509], [-0.00831, 0.56593], [-0.01060, 0.64678], [-0.01306, 0.72763], [-0.01565, 0.80848]];
  expect([path.kind, path.axis, document.frames.length, document.referenceFrameIndex]).toEqual(["irc", { kind: "reaction-coordinate" }, 21, 10]);
  close(path.points.map((point) => point.x), summary.map(([, x]) => x), 1e-5);
  const ts = path.points[10].energyHartree;
  expect(ts).toBe(-93.1140196);
  close(path.points.map((point) => point.energyHartree - ts), summary.map(([energy]) => energy), 6e-6);
  expect(path.points.map((point) => point.frame)).toEqual(document.frames.map((_, i) => i));
});

// Gaussian reports IRC points in a frame centred on the centre of mass, with its own isotope masses.
const MASS: Record<string, number> = { H: 1.007825, C: 12, N: 14.003074, O: 15.9949146 };
type Atoms = Array<{ element: string; x: number; y: number; z: number }>;
const massCentre = (atoms: Atoms) => {
  const total = atoms.reduce((sum, atom) => sum + MASS[atom.element], 0);
  return Math.hypot(...(["x", "y", "z"] as const).map((k) => atoms.reduce((sum, atom) => sum + MASS[atom.element] * atom[k], 0) / total));
};
const rmsd = (a: Atoms, b: Atoms) => Math.sqrt(a.reduce((sum, atom, i) => sum + (atom.x - b[i].x) ** 2 + (atom.y - b[i].y) ** 2 + (atom.z - b[i].z) ** 2, 0) / a.length);

test("the TS of a Gaussian IRC sits in the frame of its path points", () => {
  // This job reads the TS from a checkpoint and prints no geometry table before its first step.
  const hcn = read("HCN-ts-irc.log");
  for (const frame of hcn.frames) expect(massCentre(frame.atoms)).toBeLessThan(1e-3);
  // The TS is the checkpoint structure (C–H 1.19575 Å), one step from its neighbours on both sides.
  const [carbon, , hydrogen] = hcn.frames[10].atoms;
  expect(Math.hypot(carbon.x - hydrogen.x, carbon.y - hydrogen.y, carbon.z - hydrogen.z)).toBeCloseTo(1.19575, 4);
  const step = rmsd(hcn.frames[11].atoms, hcn.frames[12].atoms);
  for (const neighbour of [9, 11]) expect(Math.abs(rmsd(hcn.frames[10].atoms, hcn.frames[neighbour].atoms) - step)).toBeLessThan(0.2 * step);

  // This job computes the TS first, in the input frame 0.82 Å from the centre of mass.
  const reverse = read("rxn_1_irc_2.excerpt.out");
  const ts = reverse.referenceFrameIndex!;
  expect(massCentre(reverse.frames[ts].atoms)).toBeLessThan(1e-3);
  expect(Math.abs(rmsd(reverse.frames[ts].atoms, reverse.frames[ts - 1].atoms) - rmsd(reverse.frames[ts - 1].atoms, reverse.frames[ts - 2].atoms))).toBeLessThan(1e-3);
});

test("a reverse-only Gaussian IRC runs to negative coordinates, as its summary prints", () => {
  const document = read("rxn_1_irc_2.excerpt.out");
  const path = document.path!;
  // "Summary of reaction path following": 51 rows from -3.61655 to the TS at 0, energies relative to the TS.
  expect([path.points.length, document.frames.length, document.referenceFrameIndex]).toEqual([51, 51, 50]);
  close(path.points.slice(0, 4).map((point) => point.x), [-3.61655, -3.54421, -3.47186, -3.39952], 1e-5);
  close(path.points.slice(-3).map((point) => point.x), [-0.14469, -0.07236, 0], 1e-5);
  const ts = path.points[50].energyHartree;
  expect(ts).toBe(-303.577879721);
  close(path.points.slice(0, 4).map((point) => point.energyHartree - ts), [-0.03600, -0.03587, -0.03572, -0.03556], 6e-6);
  close(path.points.slice(-3, -1).map((point) => point.energyHartree - ts), [-0.00125, -0.00032], 6e-6);
});

// ORCA 6.1.1 "IRC PATH SUMMARY" of the SN2 run, E(Eh) by step; step 13 is the TS.
const ORCA_IRC = [-3073.691287, -3073.691271, -3073.691194, -3073.691094, -3073.690967, -3073.690807, -3073.690635, -3073.690540, -3073.690373, -3073.689228,
  -3073.687149, -3073.685119, -3073.683420, -3073.685423, -3073.688467, -3073.692088, -3073.695419, -3073.697323, -3073.698410, -3073.698773,
  -3073.698843, -3073.699009, -3073.699170, -3073.699303, -3073.699416, -3073.699509, -3073.699576, -3073.699587];

test("an ORCA IRC output gives its path summary with the TS at step zero", () => {
  const path = read("sn2_irc.out").path!;
  expect([path.kind, path.axis]).toEqual(["irc", { kind: "step" }]);
  expect(path.points.map((point) => point.energyHartree)).toEqual(ORCA_IRC);
  expect(path.points.map((point) => point.x)).toEqual(ORCA_IRC.map((_, i) => i - 12));
  // The output holds only the TS geometry; the points' geometries are in the _IRC_Full_trj.xyz.
  expect(path.points.every((point) => point.frame === undefined)).toBe(true);
});

test("ORCA's IRC trajectory links every path point to its geometry", () => {
  const document = read("sn2_irc_IRC_Full_trj.xyz");
  const path = document.path!;
  close(path.points.map((point) => point.energyHartree), ORCA_IRC, 5e-7);
  expect(path.points.map((point) => [point.x, point.frame])).toEqual(ORCA_IRC.map((_, i) => [i - 12, i]));
});

test("an ORCA parameter scan gives the surface it prints, one geometry per point", () => {
  const document = read("dvb_scan_unrelaxed.out");
  const path = document.path!;
  expect([path.kind, path.axis, path.points.length]).toEqual(["scan", { kind: "parameter" }, 12]);
  // "The Calculated Surface using the 'Actual Energy'".
  expect(path.points.slice(0, 3).map((point) => [point.x, point.energyHartree])).toEqual([[0, -375.8250602], [32.72727273, -379.15452391], [65.45454545, -379.56823943]]);
  expect(path.points.map((point) => point.frame)).toEqual(document.frames.map((_, i) => i));
});

test("a restored document keeps a valid path and refuses a broken one", () => {
  const document = read("relaxed_PES_testCO2.log");
  // The scene shows the reference geometry, the last one printed.
  const xyz = readXyzFrames(`${document.atoms.length}\n\n${document.atoms.map((atom) => `${atom.element} ${atom.x} ${atom.y} ${atom.z}`).join("\n")}\n`);
  expect(validateScientificDocument(document, xyz).path).toEqual(document.path);
  const broken = (path: ReactionPath) => () => validateScientificDocument({ ...document, path }, xyz);
  expect(broken({ ...document.path!, points: [{ x: 1, energyHartree: -1, frame: document.frames.length }] })).toThrow("path");
  expect(broken({ ...document.path!, axis: { kind: "bond", atoms: [0, 99] } })).toThrow("path");
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";

const read = (name: string) => parseScientificFile(name, readFileSync(new URL(`./fixtures/quantum/orca-log/${name}`, import.meta.url), "utf8"));
const first = (sets: { model: string; values: number[] }[] | undefined) => sets?.map((set) => [set.model, set.values[0]]);

// Every value is copied from the output.
test("an open-shell ORCA output keeps each population's charges and spins, Hirshfeld included, and ⟨S²⟩", () => {
  const document = read("cclib-orca6-dvb_sp_un_dft.out");
  const frame = document.frames.at(-1)!;
  expect(first(frame.charges)).toEqual([["mulliken", 0.055649], ["lowdin", 0.079783], ["hirshfeld", 0.069911]]);
  expect(first(frame.spinPopulations)).toEqual([["mulliken", 0.21376], ["lowdin", 0.203855], ["hirshfeld", 0.161509]]);
  // A doublet cation: 35 alpha and 34 beta electrons, so the spins add up to one.
  for (const set of frame.spinPopulations!) expect(set.values.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 3);
  expect(frame.spinSquared).toBe(0.778154);
  expect(document.metadata).toMatchObject({ charge: 1, multiplicity: 2 });
});

test("a closed-shell ORCA output has no spins, and each optimization step its gradient as forces", () => {
  const document = read("cclib-orca6-dvb_gopt.out");
  expect(document.frames.some((frame) => frame.spinPopulations || frame.spinSquared !== undefined)).toBe(false);
  // Three gradients for the three computed geometries; the final reprint has none of its own.
  expect(document.frames.map((frame) => Boolean(frame.forcesKcalMolAngstrom))).toEqual([true, true, true, false]);
  // `1 C : 0.000763548 0.000179736 0.000000092` Eh/bohr, the negative gradient in kcal/(mol·Å).
  const toForce = -627.5094740631 / 0.529177210903;
  [0.000763548, 0.000179736, 0.000000092].forEach((gradient, axis) => expect(document.frames[0].forcesKcalMolAngstrom![0][axis]).toBeCloseTo(gradient * toForce, 12));
});

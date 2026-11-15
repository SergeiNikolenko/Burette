import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";

const read = (path: string) => parseScientificFile(path.split("/").pop()!, readFileSync(new URL(path, import.meta.url), "utf8"));
const steps = (path: string) => read(path).frames.map((frame) => frame.convergence ?? null);

// Every expected number is copied from the convergence table the program printed for that step.
test("Gaussian optimization steps keep the Berny table of the geometry they were computed at", () => {
  const frames = steps("fixtures/quantum/gaussian/cclib-dvb_gopt.out");
  expect(frames).toHaveLength(5);
  expect(frames[0]).toEqual({ maxForce: { value: 0.06068, threshold: 0.00045 }, rmsForce: { value: 0.012894, threshold: 0.0003 },
    maxStep: { value: 0.556332, threshold: 0.0018 }, rmsStep: { value: 0.138777, threshold: 0.0012 } });
  expect(frames.map((frame) => frame?.maxForce?.value ?? null)).toEqual([0.06068, 0.012462, 0.001112, 0.000309, 0.000036]);
});

test("Psi4 and NWChem step rows belong to the frame whose energy they print, with the printed criteria", () => {
  const psi4 = steps("fixtures/quantum/psi4/water-opt-freq.out");
  expect(psi4.map((frame) => frame?.maxForce?.value)).toEqual([4.4e-2, 5.56e-3, 7.25e-4, 3.22e-5]);
  // RMS force and RMS displacement are inactive criteria in this run, so they have no threshold.
  expect(psi4[3]).toEqual({ energyChange: { value: 1.42e-6, threshold: 1e-6 }, maxForce: { value: 3.22e-5, threshold: 3e-4 }, rmsForce: { value: 2.71e-5 }, maxStep: { value: 5.96e-5, threshold: 1.2e-3 }, rmsStep: { value: 5.44e-5 } });
  const nwchem = steps("fixtures/quantum/nwchem/water-opt-freq.out");
  // NWChem prints no energy threshold; its first row's zero change is no step.
  expect(nwchem[0]?.energyChange).toBeUndefined();
  expect(nwchem[1]).toEqual({ energyChange: { value: 0.0039 }, maxForce: { value: 0.00163, threshold: 0.00045 }, rmsForce: { value: 0.00114, threshold: 0.0003 },
    rmsStep: { value: 0.03663, threshold: 0.0012 }, maxStep: { value: 0.07445, threshold: 0.0018 } });
  expect(nwchem.map((frame) => frame?.maxForce?.value)).toEqual([0.04402, 0.00163, 0.00022, 0.00002]);
});

test("Q-Chem and ORCA convergence prints use their own item names", () => {
  const qchem = steps("fixtures/quantum/qchem/cclib-dvb_gopt.out");
  expect(qchem[0]).toEqual({ maxForce: { value: 0.04166, threshold: 0.0003 }, maxStep: { value: 0.154495, threshold: 0.0012 } });
  expect(qchem.at(-1)).toEqual({ maxForce: { value: 0.000057, threshold: 0.0003 }, maxStep: { value: 0.000264, threshold: 0.0012 },
    energyChange: { value: 0.000001, threshold: 0.000001 } });
  const orca = steps("../apps/burette-public-plugin/public/demo-library/Motion & Reactions/bimp.out");
  expect(orca[0]).toEqual({ rmsForce: { value: 0.0004987439, threshold: 0.0001 }, maxForce: { value: 0.0082486714, threshold: 0.0003 },
    rmsStep: { value: 0.0101072568, threshold: 0.002 }, maxStep: { value: 0.1001858665, threshold: 0.004 } });
  expect(orca[57]?.rmsForce).toEqual({ value: 6.355e-7, threshold: 0.0001 });
});

test("a session document keeps valid convergence and refuses a malformed step", () => {
  const document = read("fixtures/quantum/psi4/water-opt-freq.out");
  // The scene shows the reference geometry, the last one printed.
  const xyz = `${document.atoms.length}\n\n${document.atoms.map((atom) => `${atom.element} ${atom.x} ${atom.y} ${atom.z}`).join("\n")}\n`;
  expect(validateScientificDocument(document, readXyzFrames(xyz)).frames[3].convergence).toEqual(document.frames[3].convergence);
  const broken = { ...document, frames: document.frames.map((frame, index) => index ? frame : { ...frame, convergence: { maxForce: { value: -1 } } }) };
  expect(() => validateScientificDocument(broken, readXyzFrames(xyz))).toThrow("convergence");
});

test("GAMESS search steps keep the gradient row of their geometry, with OPTTOL and OPTTOL/3 as thresholds", () => {
  const frames = steps("fixtures/quantum/gamess/cclib-dvb_gopt_a.out");
  // `NSERCH: n E= ... GRAD. MAX= ... R.M.S.= ...` for searches 0-6, under `OPTTOL = 1.000E-04`.
  expect(frames.slice(0, 7).map((frame) => frame?.maxForce?.value)).toEqual([0.0013457, 0.0010067, 0.0002726, 0.0004048, 0.0001882, 0.0001071, 0.0000391]);
  expect(frames[6]).toEqual({ maxForce: { value: 0.0000391, threshold: 1e-4 }, rmsForce: { value: 0.0000132, threshold: 1e-4 / 3 } });
});

test("xtb keeps each xtbopt.log frame's gradient norm, and the output's last cycle with its thresholds on the final structure", () => {
  // `energy: ... gnorm: ...` comments of the five frames.
  expect(steps("fixtures/quantum/xtb/water-opt-xtbopt.log").map((frame) => frame?.gradientNorm?.value))
    .toEqual([0.048694535466, 0.015352292721, 0.001938010054, 0.000623162525, 0.000247710605]);
  // CYCLE 5: `change -0.2592887E-06 Eh`, `gradient norm : 0.0002477 Eh/α`, under 0.5E-05 Eh and 0.1E-02 Eh/α.
  expect(steps("fixtures/quantum/xtb/water-opt.out")).toEqual([{ energyChange: { value: 2.592887e-7, threshold: 5e-6 }, gradientNorm: { value: 0.0002477, threshold: 1e-3 } }]);
});

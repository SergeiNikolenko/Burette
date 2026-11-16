import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { serializeXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";
import { withVariable, zmatrixRevision } from "../apps/desktop/src/lib/workbench/zmatrix-draft";
const file = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("XYZ first and ORCA final reference are producer-owned, with distinct coordinates and energies", () => {
  const xyz = parseScientificFile("steps.xyz", file("trajectory/reference/authored-two-frame.xyz"));
  expect([xyz.referenceFrameIndex, xyz.atoms[1].x, xyz.frames.map(f => f.energyHartree)]).toEqual([0, 1, [-1.25,-2.5]]);
  expect(xyz.atoms).toBe(xyz.frames[0].atoms);
  const orca = parseScientificFile("steps.out", file("quantum/dispatcher/two-step-orca.out"));
  expect([orca.referenceFrameIndex, orca.frames.map(f => f.atoms[1].z), orca.frames.map(f => f.energyHartree)]).toEqual([1,[1,.7],[-1.1,-1.2]]);
  expect(orca.atoms).toBe(orca.frames[1].atoms);
  expect(orca.modes[1]).toMatchObject({ frequencyCm1:-12.5, displacements:[[.1,0,-.1],[-.1,0,.1]] });
  expect(orca.orbitals.map(o => [o.energyHartree,o.occupancy])).toEqual([[-.5,2],[.2,0]]);
});

test("Gaussian printed orientations and QCSchema omitted endpoint retain their actual reference, never a prior energy", () => {
  const gaussian = parseScientificFile("water.log", file("quantum/gaussian-water-optimization.log"));
  expect(gaussian.referenceFrameIndex).toBe(3);
  expect(gaussian.atoms).toBe(gaussian.frames[3].atoms);
  expect(gaussian.frames[0].atoms).not.toEqual(gaussian.atoms);
  expect(gaussian.atoms[1]).toEqual({element:"H",x:-0,y:.755981,z:-.475764});
  expect(gaussian.frames[3].energyHartree).toBe(-76.340665699);
  const step = JSON.parse(file("quantum/qcschema-water-gradient.json"));
  const initial = structuredClone(step.molecule), final = structuredClone(step.molecule);
  step.molecule.geometry[2] += .1; final.geometry[2] += .2;
  const q = parseScientificFile("opt.qcschema", JSON.stringify({schema_name:"qcschema_optimization_output",schema_version:1,success:true,
    initial_molecule:initial,final_molecule:final,trajectory:[step],energies:[-76.02141836717794]}));
  expect(q.referenceFrameIndex).toBe(2); expect(q.atoms).toBe(q.frames[2].atoms);
  for (const [i, z] of [-.06851624661707532, -.01559852552677532, .03731919556352469].entries()) expect(q.frames[i].atoms[0].z).toBeCloseTo(z, 14);
  expect(q.frames.map(f => [f.energyHartree, !!f.forcesKcalMolAngstrom])).toEqual([[undefined,false],[-76.02141836717794,true],[undefined,false]]);
});

test("single-geometry producers declare zero and a real Z-matrix edit resets its history reference", () => {
  for (const [name, raw] of [
    ["water.fchk",file("quantum/gaussian16-water-raman.fchk")],
    ["h.molden",file("quantum/dispatcher/hydrogen.molden")],
    ["h.hess",file("quantum/dispatcher/normal-modes.hess")],
    ["q.qcschema",file("quantum/qcschema-water-gradient.json")],
    ["field.cube","comment\ncomment\n1 1 2 3\n-2 1 0 0\n-1 0 1 0\n-1 0 0 1\n8 0 1 2 3\n.1 -.2\n"],
  ]) { const doc = parseScientificFile(name, raw); expect(doc.referenceFrameIndex).toBe(0); expect(doc.atoms).toBe(doc.frames[0].atoms); }
  const z = parseScientificFile("co.zmat", "C\nO 1 R\nR=1.2\n"), text = serializeXyz(z.atoms,"reference");
  const changed = zmatrixRevision(z, withVariable(z.internalCoordinates!, "R", 1.6), text, []);
  expect(changed.document.referenceFrameIndex).toBe(0);
  expect(changed.document.frames).toHaveLength(1); expect(changed.document.atoms).toBe(changed.document.frames[0].atoms);
  const [a,b] = changed.document.atoms; expect(Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)).toBeCloseTo(1.6,12);
  expect(changed.document.atoms).not.toEqual(z.atoms);
});

test("default validation preserves identity; sole-frame read normalization is shallow, once, and never guesses multiframe history", () => {
  const parsed = parseScientificFile("co.xyz",file("trajectory/reference/authored-two-frame.xyz"));
  const { referenceFrameIndex: _, ...legacy } = parsed;
  const source = readXyzFrames(serializeXyz(legacy.atoms,"legacy"));
  Object.freeze(legacy); Object.freeze(legacy.frames); Object.freeze(legacy.atoms);
  expect(validateScientificDocument(legacy,source)).toBe(legacy);
  expect(validateScientificDocument(legacy,source,undefined,{normalizeReference:true})).toBe(legacy);
  const sole = {...legacy, frames:[legacy.frames[0]]}; Object.freeze(sole.frames); Object.freeze(sole);
  expect(validateScientificDocument(sole,source)).toBe(sole);
  const read = validateScientificDocument(sole,source,undefined,{normalizeReference:true});
  expect(read).not.toBe(sole); expect(read.referenceFrameIndex).toBe(0);
  expect(read.atoms).toBe(sole.atoms); expect(read.frames).toBe(sole.frames); expect(read.frames[0]).toBe(sole.frames[0]);
  expect(sole).not.toHaveProperty("referenceFrameIndex");
  expect(validateScientificDocument(read,source,undefined,{normalizeReference:true})).toBe(read);
  for (const referenceFrameIndex of [-1, .5, 2, 1, NaN]) expect(() => validateScientificDocument({...legacy,referenceFrameIndex},source)).toThrow("reference frame");
  const duplicate = {...legacy,frames:[legacy.frames[0],legacy.frames[0]]};
  expect(validateScientificDocument(duplicate,source,undefined,{normalizeReference:true})).toBe(duplicate);
});

test("CJSON graph active set stays authoritative and conflicting explicit references are rejected", () => {
  const input = JSON.parse(file("trajectory/retained-nmr.cjson")); input.atoms.coords["3dSetsActive"] = 5;
  const doc = parseScientificFile("nmr.cjson",JSON.stringify(input));
  const source = readXyzFrames(serializeXyz(doc.atoms,"graph"));
  expect(doc.graph!.activeFrameIndex).toBe(5);
  expect(validateScientificDocument(doc,source,doc.graph!.molfile, {normalizeReference:true})).toBe(doc);
  expect(doc.referenceFrameIndex).toBeUndefined();
  expect(() => validateScientificDocument({...doc,referenceFrameIndex:0},source,doc.graph!.molfile)).toThrow();
});

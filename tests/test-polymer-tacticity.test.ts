import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import initRDKitModule, { type MainModule } from "@rdkit/rdkit";
import { buildPolymer, type PolymerOptions } from "../apps/desktop/src/lib/molecular-workbench/polymer";
import { sdfFromGraph } from "../apps/desktop/src/lib/workbench/formats";
import type { MolecularAtom, MolecularBond } from "../apps/desktop/src/lib/molecular-workbench/types";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/polymer/propylene-reference.json", import.meta.url), "utf8")) as { atoms: MolecularAtom[]; bonds: MolecularBond[]; roles: Pick<PolymerOptions, "head" | "tail" | "headLeaving" | "tailLeaving"> };
const references = JSON.parse(readFileSync(new URL("./fixtures/polymer/tacticity-references.json", import.meta.url), "utf8")).references as { name: string; smiles: string; flipPattern: (0 | 1)[]; rdkitCip: [number, string][] }[];
let rdkit: MainModule;
beforeAll(async () => { rdkit = await initRDKitModule(); });
const options = { ...fixture.roles, count: 6, bondLength: 1.54 };
const canonical = (input: string) => { const mol = rdkit.get_mol(input, JSON.stringify({ removeHs: true })); if (!mol) throw new Error("Invalid independent molecule"); try { return mol.get_smiles(); } finally { mol.delete(); } };
const tacticity = (reference: typeof references[number]): PolymerOptions["tacticity"] => reference.name === "atacticFixture" ? { kind: "atactic", alternatives: reference.flipPattern } : { kind: reference.name as "isotactic" | "syndiotactic" };

for (const reference of references) test(`${reference.name}: real 3D/SDF stereo matches frozen finite-chain graph and local alternatives`, () => {
  const source = structuredClone(fixture), p = buildPolymer(fixture.atoms, fixture.bonds, { ...options, tacticity: tacticity(reference) });
  expect(p.atoms).toHaveLength(56); expect(p.bonds).toHaveLength(55);
  expect(p.atoms.filter(a => a.element === "C")).toHaveLength(18); expect(p.atoms.filter(a => a.element === "H")).toHaveLength(38);
  expect(p.repeatAlternatives).toEqual(reference.flipPattern);
  const sdf = sdfFromGraph(p.atoms, p.bonds, reference.name), molecule = rdkit.get_mol(sdf, JSON.stringify({ removeHs: false }));
  expect(molecule).not.toBeNull();
  try {
    const json = JSON.parse(molecule!.get_json());
    expect(json.molecules[0].atoms.reduce((sum: number, atom: { impHs?: number }) => sum + (atom.impHs ?? json.defaults.atom.impHs ?? 0), 0)).toBe(0);
    const cip = (JSON.parse(molecule!.get_stereo_tags()).CIP_atoms as [number, string][]).map(([i, label]) => {
      expect(p.sourceAtomIndices[i]).toBe(fixture.roles.tail); return [p.repeatIndices[i], label];
    });
    expect(cip).toEqual(reference.rdkitCip.map(([i, label]) => [Math.floor(i / 3), label]));
    expect(canonical(sdf)).toBe(canonical(reference.smiles));
  } finally { molecule?.delete(); }
  for (let repeat = 0; repeat < options.count; repeat++) {
    const indices = p.repeatIndices.flatMap((r, i) => r === repeat ? [i] : []);
    const alternative = fixture.bonds.filter(b => b.a === fixture.roles.tail || b.b === fixture.roles.tail).map(b => b.a === fixture.roles.tail ? b.b : b.a).find(i => fixture.atoms[i].element === "H" && i !== fixture.roles.tailLeaving)!;
    const leaving = reference.flipPattern[repeat] ? alternative : fixture.roles.tailLeaving;
    expect(indices.map(i => p.sourceAtomIndices[i]).includes(leaving)).toBe(repeat === options.count - 1);
    for (const i of indices) for (const j of indices) {
      const a = p.atoms[i], b = p.atoms[j], x = fixture.atoms[p.sourceAtomIndices[i]], y = fixture.atoms[p.sourceAtomIndices[j]];
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeCloseTo(Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z), 9);
    }
  }
  expect(fixture).toEqual(source);
});

test("permuted source atoms retain finite-chain stereochemistry; an opposite seed changes the mapped configuration", () => {
  const reference = references.find(r => r.name === "isotactic")!, order = fixture.atoms.map((_, i) => i).reverse(), inverse = (index: number) => order.indexOf(index);
  const reordered = buildPolymer(order.map(i => fixture.atoms[i]), fixture.bonds.map(b => ({ ...b, a: inverse(b.a), b: inverse(b.b) })), { ...options, ...Object.fromEntries(Object.entries(fixture.roles).map(([key, i]) => [key, inverse(i)])), tacticity: { kind: "isotactic" } });
  expect(canonical(sdfFromGraph(reordered.atoms, reordered.bonds, "reordered"))).toBe(canonical(reference.smiles));
  const alternate = fixture.bonds.filter(b => b.a === fixture.roles.tail || b.b === fixture.roles.tail).map(b => b.a === fixture.roles.tail ? b.b : b.a).find(i => fixture.atoms[i].element === "H" && i !== fixture.roles.tailLeaving)!;
  const opposite = buildPolymer(fixture.atoms, fixture.bonds, { ...options, tailLeaving: alternate, tacticity: { kind: "isotactic" } });
  // A symmetric finite oligomer can be superimposable on its mirror as an
  // unlabelled graph; inspect mapped local CIP rather than requiring a new name.
  const mol = rdkit.get_mol(sdfFromGraph(opposite.atoms, opposite.bonds, "opposite"), JSON.stringify({ removeHs: false })); expect(mol).not.toBeNull();
  try { expect((JSON.parse(mol!.get_stereo_tags()).CIP_atoms as [number, string][]).map(([i, label]) => [opposite.repeatIndices[i], label])).toEqual(reference.rdkitCip.map(([i, label]) => [Math.floor(i / 3), label === "(R)" ? "(S)" : "(R)"])); } finally { mol?.delete(); }
});

test("resolved atactic choices are replayable and malformed patterns or unsupported sites fail without source mutation", () => {
  const choices = [0, 1, 1, 0, 1, 0] as (0 | 1)[], request = { ...options, tacticity: { kind: "atactic" as const, alternatives: choices } };
  expect(buildPolymer(fixture.atoms, fixture.bonds, request)).toEqual(buildPolymer(fixture.atoms, fixture.bonds, request));
  expect(choices).toEqual([0, 1, 1, 0, 1, 0]);
  expect(() => buildPolymer(fixture.atoms, fixture.bonds, { ...options, tacticity: { kind: "atactic", alternatives: [0] } })).toThrow("one resolved binary");
  expect(() => buildPolymer(fixture.atoms, fixture.bonds, { ...options, tacticity: { kind: "atactic", alternatives: Array(6) } })).toThrow("one resolved binary");
  expect(() => buildPolymer(fixture.atoms, fixture.bonds, { ...options, head: 1, tail: 0, headLeaving: fixture.roles.tailLeaving, tailLeaving: fixture.roles.headLeaving, tacticity: { kind: "syndiotactic" } })).toThrow("CH2-tail");
});

test("unresolved planar and near-planar sites are refused instead of claiming assigned tacticity", () => {
  for (const scale of [0, 1e-6, .001, .01]) for (const kind of ["isotactic", "syndiotactic"] as const) {
    const atoms = fixture.atoms.map(atom => ({ ...atom, z: atom.z * scale })), before = structuredClone(atoms);
    expect(() => buildPolymer(atoms, fixture.bonds, { ...options, bondLength: 3, tacticity: { kind } })).toThrow("resolved tetrahedron");
    expect(atoms).toEqual(before);
  }
  const p = buildPolymer(fixture.atoms.map(atom => ({ ...atom, z: atom.z * .1 })), fixture.bonds, { ...options, bondLength: 3, tacticity: { kind: "syndiotactic" } });
  const mol = rdkit.get_mol(sdfFromGraph(p.atoms, p.bonds, "resolved flattened control"), JSON.stringify({ removeHs: false })); expect(mol).not.toBeNull();
  try { expect((JSON.parse(mol!.get_stereo_tags()).CIP_atoms as [number, string][]).map(([i, label]) => [p.repeatIndices[i], label])).toEqual(references.find(r => r.name === "syndiotactic")!.rdkitCip.map(([i, label]) => [Math.floor(i / 3), label])); } finally { mol?.delete(); }
});

test("collinear original tail H cannot bypass attachment orientation when a local alternative is requested", () => {
  const atoms = fixture.atoms.map(atom => ({ ...atom })), head = atoms[fixture.roles.head], tail = atoms[fixture.roles.tail];
  const delta = [head.x - tail.x, head.y - tail.y, head.z - tail.z], u = delta.map(v => v / Math.hypot(...delta));
  atoms[fixture.roles.headLeaving] = { element: "H", x: head.x + 1.09 * u[0], y: head.y + 1.09 * u[1], z: head.z + 1.09 * u[2] };
  atoms[fixture.roles.tailLeaving] = { element: "H", x: tail.x - 1.09 * u[0], y: tail.y - 1.09 * u[1], z: tail.z - 1.09 * u[2] };
  const before = structuredClone(atoms);
  expect(() => buildPolymer(atoms, fixture.bonds, { ...options, count: 3, bondLength: 3, tacticity: { kind: "syndiotactic" } })).toThrow("resolved tetrahedron");
  expect(atoms).toEqual(before);
});

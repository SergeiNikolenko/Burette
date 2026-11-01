import { beforeAll, expect, test } from "bun:test";
import { createRequire } from "node:module";
import initRDKitModule, { type MainModule } from "@rdkit/rdkit";
import { buildPolymer } from "../apps/desktop/src/lib/molecular-workbench/polymer";
import { sdfFromGraph } from "../apps/desktop/src/lib/workbench/formats";
import type { MolecularAtom } from "../apps/desktop/src/lib/molecular-workbench/types";
const require = createRequire(import.meta.url);
const { parseMol } = require("@molstar/io/reader/mol/parser");
const { trajectoryFromMol } = require("@molstar/model/formats/structure/mol");
const { Structure } = require("@molstar/model/model/structure");
let rdkit: MainModule;
beforeAll(async () => { rdkit = await initRDKitModule(); });
const cc = 1.54, ch = 1.09;
const atoms: MolecularAtom[] = [{ element: "C", x: 0, y: 0, z: 0 }, { element: "C", x: cc, y: 0, z: 0 }];
for (const [carbon, sign] of [[0, -1], [1, 1]]) for (let i = 0; i < 3; i++) atoms.push({ element: "H", x: atoms[carbon].x + sign * ch / 3, y: ch * Math.sqrt(8 / 9) * Math.cos(i * 2 * Math.PI / 3), z: ch * Math.sqrt(8 / 9) * Math.sin(i * 2 * Math.PI / 3) });
const bonds = [{ a: 0, b: 1, order: 1 }, ...[2, 3, 4].map(b => ({ a: 0, b, order: 1 })), ...[5, 6, 7].map(b => ({ a: 1, b, order: 1 }))];
const options = { head: 0, tail: 1, headLeaving: 2, tailLeaving: 5, count: 3, bondLength: cc };
const xyz = (a: MolecularAtom) => [a.x, a.y, a.z];
const distance = (a: MolecularAtom, b: MolecularAtom) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test("attachment-directed ethane has exact caps/provenance, local rigid geometry and chosen C-H directions", () => {
  const original = structuredClone({ atoms, bonds });
  const one = buildPolymer(atoms, bonds, { ...options, count: 1 });
  expect(one.atoms).toEqual(atoms); expect(one.bonds).toEqual(bonds);
  expect(one.sourceAtomIndices).toEqual(atoms.map((_, i) => i)); expect(one.repeatIndices).toEqual(atoms.map(() => 0));
  const p = buildPolymer(atoms, bonds, options);
  expect(p.atoms).toHaveLength(20); expect(p.bonds).toHaveLength(19);
  expect(p.atoms.filter(a => a.element === "C")).toHaveLength(6);
  expect(p.atoms.map((_, i) => p.bonds.reduce((n, b) => n + (b.a === i || b.b === i ? b.order : 0), 0))).toEqual(p.atoms.map(a => a.element === "C" ? 4 : 1));
  for (let repeat = 0; repeat < 3; repeat++) {
    const indices = p.repeatIndices.flatMap((r, i) => r === repeat ? [i] : []);
    const expectedSource = atoms.flatMap((_, i) => i === 2 && repeat > 0 || i === 5 && repeat < 2 ? [] : [i]);
    expect(indices.map(i => p.sourceAtomIndices[i])).toEqual(expectedSource);
    for (const i of indices) for (const j of indices) expect(distance(p.atoms[i], p.atoms[j])).toBeCloseTo(distance(atoms[p.sourceAtomIndices[i]], atoms[p.sourceAtomIndices[j]]), 10);
    // This exact symmetric tetrahedral fixture has an analytically known proper
    // rotation diag(1,(-1)^repeat,(-1)^repeat), determinant +1.
    const sign = repeat % 2 ? -1 : 1, origin = [repeat * cc * 4 / 3, repeat % 2 ? cc * Math.sqrt(8 / 9) : 0, 0];
    for (const i of indices) {
      const source = atoms[p.sourceAtomIndices[i]], expected = [source.x + origin[0], sign * source.y + origin[1], sign * source.z];
      xyz(p.atoms[i]).forEach((v, axis) => expect(v).toBeCloseTo(expected[axis], 10));
    }
    if (repeat < 2) {
      const tail = p.atoms[indices.find(i => p.sourceAtomIndices[i] === 1)!];
      const nextHead = p.atoms[p.repeatIndices.findIndex((r, i) => r === repeat + 1 && p.sourceAtomIndices[i] === 0)];
      expect(distance(tail, nextHead)).toBeCloseTo(cc, 10);
      const expectedBond = [cc / 3, sign * cc * Math.sqrt(8 / 9), 0];
      xyz(nextHead).forEach((v, axis) => expect(v - xyz(tail)[axis]).toBeCloseTo(expectedBond[axis], 10));
    }
  }
  expect({ atoms, bonds }).toEqual(original);
});

test("rigid input transformation and arbitrary source atom reorder preserve the mapped physical output", () => {
  const p = buildPolymer(atoms, bonds, options), c = Math.cos(.73), s = Math.sin(.73);
  const transform = (a: MolecularAtom) => ({ ...a, x: c * a.x - s * a.z + 3, y: a.y - 2, z: s * a.x + c * a.z + 7 });
  const moved = buildPolymer(atoms.map(transform), bonds, options);
  moved.atoms.forEach((a, i) => xyz(a).forEach((v, axis) => expect(v).toBeCloseTo(xyz(transform(p.atoms[i]))[axis], 10)));
  const order = [7, 0, 4, 1, 3, 5, 2, 6], inverse = (i: number) => order.indexOf(i);
  const reordered = buildPolymer(order.map(i => atoms[i]), bonds.map(b => ({ ...b, a: inverse(b.a), b: inverse(b.b) })), { ...options, head: inverse(0), tail: inverse(1), headLeaving: inverse(2), tailLeaving: inverse(5) });
  reordered.atoms.forEach((a, i) => {
    const old = p.repeatIndices.findIndex((r, j) => r === reordered.repeatIndices[i] && p.sourceAtomIndices[j] === order[reordered.sourceAtomIndices[i]]);
    expect(old).toBeGreaterThanOrEqual(0); xyz(a).forEach((v, axis) => expect(v).toBeCloseTo(xyz(p.atoms[old])[axis], 10));
  });
});

test("actual SDF semantic reopen retains complete hydrogen-capped graph in RDKit and MolStar", async () => {
  const p = buildPolymer(atoms, bonds, options), sdf = sdfFromGraph(p.atoms, p.bonds, "C6H14 attachment fixture");
  const mol = rdkit.get_mol(sdf, JSON.stringify({ removeHs: false })); expect(mol).not.toBeNull();
  try {
    const json = JSON.parse(mol!.get_json()), model = json.molecules[0], defaults = json.defaults.atom;
    expect(model.atoms).toHaveLength(20);
    expect(model.atoms.reduce((n: number, a: { impHs?: number }) => n + (a.impHs ?? defaults.impHs ?? 0), 0)).toBe(0);
    expect(model.atoms.reduce((n: number, a: { nRad?: number }) => n + (a.nRad ?? defaults.nRad ?? 0), 0)).toBe(0);
    expect(model.bonds.map((b: { atoms: number[]; bo?: number }) => `${b.atoms.slice().sort((a, b) => a - b).join(":")}:${b.bo ?? json.defaults.bond.bo}`).sort()).toEqual(p.bonds.map(b => `${[b.a, b.b].sort((a, b) => a - b).join(":")}:${b.order}`).sort());
  } finally { mol?.delete(); }
  const parsed = await parseMol(sdf).run(); expect(parsed.isError).toBe(false);
  const structure = Structure.ofModel((await trajectoryFromMol(parsed.result).run()).representative);
  expect(structure.elementCount).toBe(20); expect(structure.interUnitBonds.edgeCount).toBe(0);
  const nativeEdges: string[] = [];
  for (const unit of structure.units) for (let i = 0; i < unit.bonds.a.length; i++) if (unit.bonds.a[i] < unit.bonds.b[i]) nativeEdges.push(`${[unit.elements[unit.bonds.a[i]], unit.elements[unit.bonds.b[i]]].sort((a, b) => a - b).join(":")}:${unit.bonds.edgeProps.order[i]}`);
  expect(nativeEdges.sort()).toEqual(p.bonds.map(b => `${[b.a, b.b].sort((a, b) => a - b).join(":")}:${b.order}`).sort());
});

test("unsupported terminal chemistry, degenerate attachments and invalid chemistry refuse without mutating source", () => {
  const original = structuredClone({ atoms, bonds });
  expect(() => buildPolymer(atoms, bonds, { ...options, endGroups: "open" })).toThrow("terminal valence");
  const zero = atoms.map(a => ({ ...a })); zero[2] = { ...zero[2], ...{ x: 0, y: 0, z: 0 } };
  expect(() => buildPolymer(zero, bonds, options)).toThrow("nonzero direction");
  expect(() => buildPolymer(atoms, bonds, { ...options, headLeaving: 1 })).toThrow("distinct");
  expect(() => buildPolymer(atoms, bonds, { ...options, tailLeaving: 3 })).toThrow("singly bonded hydrogen");
  expect(() => buildPolymer(atoms, bonds, { ...options, count: 501 })).toThrow("budget");
  expect({ atoms, bonds }).toEqual(original);
});

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Molecule } from 'openchemlib';
import { runChemistryTask } from '../apps/desktop/src/lib/molecular-workbench/compute-client';
import { generateFromSmiles, removeHydrogens } from '../apps/desktop/src/lib/molecular-workbench/chemistry';
import { snapshotMolecule, type MolecularStructure } from '../apps/desktop/src/lib/molecular-workbench/molecular-graph';

const sample = readFileSync(new URL('../samples/collections/sdf/single.sdf', import.meta.url), 'utf8');
const add = (molecule: MolecularStructure) => runChemistryTask({ action: 'add-hydrogens', molecule });
function check(before: MolecularStructure, after: MolecularStructure) {
  expect(after.atoms.slice(0, before.atoms.length)).toEqual(before.atoms);
  expect(after.bonds.slice(0, before.bonds.length)).toEqual(before.bonds);
  const distances: number[] = [];
  for (let i = before.atoms.length; i < after.atoms.length; i++) {
    const bonds = after.bonds.filter(b => b.a === i || b.b === i);
    expect(after.atoms[i].element).toBe('H'); expect(bonds).toHaveLength(1);
    const a = after.atoms[i], p = after.atoms[bonds[0].a === i ? bonds[0].b : bonds[0].a];
    const d = Math.hypot(a.x - p.x, a.y - p.y, a.z - p.z);
    expect(Number.isFinite(d)).toBe(true); expect(d).toBeGreaterThan(.5); expect(d).toBeLessThan(1.7);
    distances.push(d);
  }
  return distances;
}
test('the actual collinear CCO sample adds six H through the real worker with positive C–H bonds', async () => {
  const before = await runChemistryTask({ action: 'parse', source: sample, format: 'sdf' });
  const after = await add(before);
  expect(after.atoms).toHaveLength(9); expect(check(before, after)).toHaveLength(6);
  expect((await runChemistryTask({ action: 'properties', molecule: after })).formula).toBe('C2H6O');
  expect(before.atoms).toHaveLength(3);
});
test('collinear source orientations, including a vertical 3D axis and near-collinearity, preserve the exact heavy pose', async () => {
  const source = await runChemistryTask({ action: 'parse', source: sample, format: 'sdf' });
  for (const direction of [[0, 0, 1], [2 / 3, -1 / 3, 2 / 3], [1, 1e-10, 0]]) {
    const before = { ...source, atoms: source.atoms.map(a => ({ ...a, x: 3 + a.x * direction[0], y: -7 + a.x * direction[1], z: 11 + a.x * direction[2] })) };
    const after = await add(before); check(before, after);
    const centerH = after.bonds.filter(b => (b.a === 1 && b.b >= 3) || (b.b === 1 && b.a >= 3)).map(b => after.atoms[b.a === 1 ? b.b : b.a]);
    for (const h of centerH) expect(Math.abs((h.x - 3) * direction[0] + (h.y + 7) * direction[1] + (h.z - 11) * direction[2])).toBeLessThan(1e-8);
  }
});
test('ordinary 3D placement rotates with source geometry and keeps preexisting H, isotopes and charges', async () => {
  const full = generateFromSmiles('[13CH3][NH2+]CCO');
  const heavy = removeHydrogens(full);
  const original = Molecule.fromMolfile(full.molfile);
  original.deleteAtoms(Array.from({ length: original.getAllAtoms() }, (_, i) => i).filter(i => original.getAtomLabel(i) === 'H').slice(1));
  const partial = snapshotMolecule(original);
  const first = await add(partial); check(partial, first);
  const rotate = (a: typeof partial.atoms[number]) => ({ ...a, x: 5 + a.z, y: a.x - 2, z: a.y + 7 });
  const rotated = { ...partial, atoms: partial.atoms.map(rotate) }, second = await add(rotated);
  check(rotated, second);
  // New identical H may be permuted. Compare the local H sets at source sites
  // with two existing neighbours; RDKit's repeated placement is approximate.
  const framed = partial.atoms.map((_, i) => i).filter(i => partial.bonds.filter(b => b.a === i || b.b === i).length >= 2);
  for (const parent of framed) {
    const indices = first.bonds.filter(b => b.a === parent && b.b >= partial.atoms.length).map(b => b.b);
    for (const i of indices) {
      const a = rotate(first.atoms[i]);
      const nearest = Math.min(...indices.map(j => Math.hypot(a.x - second.atoms[j].x, a.y - second.atoms[j].y, a.z - second.atoms[j].z)));
      expect(nearest).toBeLessThan(.02);
    }
  }
  for (const result of [first, second]) {
    const mol = Molecule.fromMolfile(result.molfile);
    expect(mol.getAtomMass(0)).toBe(13); expect(mol.getAtomCharge(1)).toBe(1);
  }
  expect(heavy.atoms.length).toBeLessThan(first.atoms.length);
});
test('disconnected components retain their source pose and existing hydrogens', async () => {
  const before = removeHydrogens(generateFromSmiles('CCO.O'));
  const after = await add(before); check(before, after);
  expect((await runChemistryTask({ action: 'properties', molecule: after })).formula).toBe('C2H8O2');
});
test('an opposed NH site has a positive bond and an off-axis source branch determines the collinear CH2 frame', async () => {
  const amine = sample.replace('    0.0000    0.0000    0.0000 C', '    0.0000    0.0000    0.0000 N').replace(/ O   0/g, ' C   0');
  const nh = await runChemistryTask({ action: 'parse', source: amine, format: 'sdf' });
  check(nh, await add(nh));
  const mol = Molecule.fromSmiles('CCCO'), xyz = [[-1.5, 0, 0], [0, 0, 0], [1.5, 0, 0], [2, 1, 1]];
  xyz.forEach((v, i) => { mol.setAtomX(i, v[0]); mol.setAtomY(i, v[1]); mol.setAtomZ(i, v[2]); });
  const before = snapshotMolecule(mol), first = await add(before);
  const rotate = (a: typeof before.atoms[number]) => ({ ...a, x: 5 + a.z, y: a.x - 2, z: a.y + 7 });
  const rotated = { ...before, atoms: before.atoms.map(rotate) }, second = await add(rotated);
  check(before, first); check(rotated, second);
  const centerH = first.bonds.filter(b => b.a === 1 && b.b >= 4).map(b => b.b);
  expect(centerH).toHaveLength(2);
  for (const i of centerH) {
    const expected = rotate(first.atoms[i]);
    expect(second.atoms[i].x).toBeCloseTo(expected.x, 8); expect(second.atoms[i].y).toBeCloseTo(expected.y, 8); expect(second.atoms[i].z).toBeCloseTo(expected.z, 8);
  }
});
test('coincident bonded source atoms fail without changing the input graph', async () => {
  const source = await runChemistryTask({ action: 'parse', source: sample, format: 'sdf' });
  source.atoms[0] = { ...source.atoms[1] };
  const before = structuredClone(source);
  await expect(add(source)).rejects.toThrow('coincident bonded atoms'); expect(source).toEqual(before);
});
test('specified stereo survives hydrogen expansion and unspecified planar centers remain unspecified', async () => {
  for (const smiles of ['C[C@H](O)F', 'C[C@@H](O)F', 'F/C=C/F', 'F/C=C\\F']) {
    const before = removeHydrogens(generateFromSmiles(smiles));
    const after = await add(before); check(before, after);
    expect(Molecule.fromMolfile(after.molfile).toIsomericSmiles()).toBe(Molecule.fromMolfile(before.molfile).toIsomericSmiles());
  }
  const mol = Molecule.fromSmiles('CC(O)F');
  for (let i = 0; i < mol.getAllAtoms(); i++) { mol.setAtomX(i, [0, 1, 2, 1][i]); mol.setAtomY(i, [0, 0, .7, -1][i]); mol.setAtomZ(i, 0); }
  const before = snapshotMolecule(mol), after = await add(before);
  check(before, after);
  let reopened = after;
  for (let i = 0; i < 3; i++) {
    expect(Molecule.fromMolfile(reopened.molfile).toIsomericSmiles()).not.toContain('@');
    reopened = await runChemistryTask({ action: 'parse', source: reopened.molfile, format: 'mol' });
  }
});

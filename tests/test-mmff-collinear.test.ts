import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Molecule, ForceFieldMMFF94 } from 'openchemlib';
import { runChemistryTask } from '../apps/desktop/src/lib/molecular-workbench/compute-client';
import { runGraphTask } from '../apps/desktop/src/lib/molecular-workbench/graph-compute-client';
import { snapshotMolecule } from '../apps/desktop/src/lib/molecular-workbench/molecular-graph';
import { getEnergy, generateFromSmiles } from '../apps/desktop/src/lib/molecular-workbench/chemistry';

test('actual sample AddH and graph normalization preserve the MMFF singular pose and report nonfinite energy without mutation', async () => {
  const source = readFileSync(new URL('../samples/collections/sdf/single.sdf', import.meta.url), 'utf8');
  const before = await runChemistryTask({ action: 'parse', source, format: 'sdf' });
  const added = await runChemistryTask({ action: 'add-hydrogens', molecule: before });
  const molecule = await runGraphTask({ action: 'edit-graph', molecule: added, edits: [{ kind: 'reorder-atoms', order: added.atoms.map((_, i) => i) }] });
  expect(molecule.atoms).toHaveLength(9); expect(molecule.atoms.slice(0, 3)).toEqual(before.atoms);
  const snapshot = structuredClone(molecule);
  for (const forceField of ['MMFF94', 'MMFF94s'] as const) {
    await expect(runChemistryTask({ action: 'energy', molecule, forceField })).rejects.toThrow(/energy is not finite for the current coordinates.*Change the geometry or generate a 3D conformer/);
    for (const method of [undefined, 'lbfgs', 'fire', 'abc-fire', 'hybrid'] as const) {
      await expect(runChemistryTask({ action: 'optimize', molecule, options: { forceField, method } })).rejects.toThrow(/energy is not finite for the current coordinates/);
    }
  }
  expect(molecule).toEqual(snapshot);
});

test('genuinely linear acetylene remains finite under both MMFF variants when no torsion term is active', () => {
  const mol = new Molecule(4, 3);
  [6, 6, 1, 1].forEach((z, i) => { mol.addAtom(z); mol.setAtomX(i, [-.6, .6, -1.66, 1.66][i]); });
  const triple = mol.addBond(0, 1); mol.setBondType(triple, Molecule.cBondTypeTriple); mol.addBond(0, 2); mol.addBond(1, 3);
  const molecule = snapshotMolecule(mol);
  for (const field of ['MMFF94', 'MMFF94s'] as const) expect(Number.isFinite(getEnergy(molecule, field))).toBe(true);
});

test('nonfinite coordinates get an honest energy error and unsupported chemistry retains its constructor error', async () => {
  const water = generateFromSmiles('O'), oxygen = water.atoms[0];
  water.atoms[1] = { ...water.atoms[1], x: oxygen.x, y: oxygen.y, z: oxygen.z };
  await expect(runChemistryTask({ action: 'energy', molecule: water, forceField: 'MMFF94' })).rejects.toThrow('MMFF94 energy is not finite for the current coordinates. Change the geometry or generate a 3D conformer.');
  const unsupported = snapshotMolecule(Molecule.fromSmiles('[Fe]'));
  let originalError = '';
  try { new ForceFieldMMFF94(Molecule.fromMolfile(unsupported.molfile), 'MMFF94'); } catch (error) { originalError = String(error); }
  expect(originalError).not.toBe('');
  await expect(runChemistryTask({ action: 'energy', molecule: unsupported, forceField: 'MMFF94' })).rejects.toThrow(originalError.replace(/^Error: /, ''));
});

test('MMFF94 still optimizes an ordinary 3D pose with the same graph', async () => {
  const molecule = await runChemistryTask({ action: 'generate', smiles: 'CCO' });
  const result = await runChemistryTask({ action: 'optimize', molecule, options: { forceField: 'MMFF94', method: 'lbfgs', maxIterations: 80 } });
  expect(Number.isFinite(result.energy)).toBe(true); expect(result.energy).toBeLessThan(result.initialEnergy);
  expect(result.molecule.bonds).toEqual(molecule.bonds);
});

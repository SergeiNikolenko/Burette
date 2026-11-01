import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Molecule } from 'openchemlib';
import { runGraphTask as task } from '../apps/desktop/src/lib/molecular-workbench/graph-compute-client';
import { readUnspecifiedMolfileStereo } from '../apps/desktop/src/lib/molecular-workbench/molecule-stereochemistry';
const input = (name: string) => task({ action: 'parse', source: readFileSync(new URL(`./fixtures/graph-normalization/${name}.mol`, import.meta.url), 'utf8'), format: 'mol' });

test('reorder and its inverse retain unknown tetra/axial/E-Z source identities through an ordinary reopen', async () => {
  for (const [name, center] of [['unspecified-center', 1], ['unknown-pentadiene', 2], ['unspecified-alkene', null]] as const) {
    const source = await input(name), saved = JSON.stringify(source), order = source.atoms.map((_, i) => source.atoms.length - i - 1);
    const result = await task({ action: 'edit-graph', molecule: source, edits: [{ kind: 'reorder-atoms', order }, { kind: 'reorder-atoms', order }] });
    expect(result.sourceAtomIndices).toEqual(source.atoms.map((_, i) => i));
    const reopened = await task({ action: 'parse', source: result.molfile, format: 'mol' });
    const { molecule: m, map } = Molecule.fromMolfileWithAtomMap(reopened.molfile);
    const unknown = readUnspecifiedMolfileStereo(m, reopened.molfile, map);
    if (center !== null) expect(unknown.atoms.map(i => Array.from(map).indexOf(i))).toContain(center);
    else expect(unknown.bonds).toHaveLength(1);
    expect(reopened.atoms.map(a => a.element)).toEqual(source.atoms.map(a => a.element));
    expect(JSON.stringify(source)).toBe(saved);
  }
}, 30_000);

test('identity normalization preserves actual reflected 3D bodies; reordering remaps stereo collections', async () => {
  const original = JSON.parse(readFileSync(new URL('./fixtures/graph-normalization/physical-lactic-at.json', import.meta.url), 'utf8'));
  for (const sign of [1, -1]) {
    const source = { ...original, atoms: original.atoms.map((a: {x: number}) => ({ ...a, x: sign * a.x })) };
    const result = await task({ action: 'edit-graph', molecule: source, edits: [{ kind: 'reorder-atoms', order: source.atoms.map((_: unknown, i: number) => i) }] });
    expect(result.sourceAtomIndices).toEqual(source.atoms.map((_: unknown, i: number) => i));
    for (let i = 0; i < source.atoms.length; i++) for (const axis of ['x', 'y', 'z'] as const) expect(result.atoms[i][axis]).toBeCloseTo(source.atoms[i][axis], 8);
  }
  const reversed = original.atoms.map((_: unknown, i: number) => original.atoms.length - i - 1);
  const result = await task({ action: 'edit-graph', molecule: original, edits: [{ kind: 'reorder-atoms', order: reversed }] });
  // The MDLV30/STEABS collection follows the stereocentre (row 2 becomes row 11) and the configuration survives.
  expect(result.molfile).toContain('M  V30 MDLV30/STEABS ATOMS=(1 11)');
  const smiles = (molfile: string) => Molecule.fromMolfile(molfile).toIsomericSmiles();
  expect(smiles(result.molfile)).toBe(smiles(original.molfile));
});

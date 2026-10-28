import { expect, test } from 'bun:test';
import { Molecule } from 'openchemlib';
import { runGraphTask } from '../apps/desktop/src/lib/molecular-workbench/graph-compute-client';
import { runGraphOperation } from '../apps/desktop/src/lib/molecular-workbench/graph-operations';
import { runWorkerTask } from '../apps/desktop/src/lib/molecular-workbench/worker-task';
import { atomAnnotations } from '../apps/desktop/src/lib/workbench/graph-annotations';
import { checkPositionsOnlyEdit, molfileWithPositions } from '../apps/desktop/src/lib/workbench/graph-positions';
import type { Vec3 } from '../apps/desktop/src/lib/molecular-workbench/types';

// Plain H interrupts the heavy-atom source order; N has an explicit charge and a double bond.
const interleaved = [
  'Graph worker', 'Burette', '', '  0  0  0     0  0            999 V3000',
  'M  V30 BEGIN CTAB', 'M  V30 COUNTS 6 5 0 0 0', 'M  V30 BEGIN ATOM',
  'M  V30 1 C 0 0 0 0 MASS=13', 'M  V30 2 H -1 0 0 0', 'M  V30 3 N 1 0 0 0 CHG=1',
  'M  V30 4 O 2 0 0 0', 'M  V30 5 F 0 1 1 0', 'M  V30 6 F 0 -1 1 0',
  'M  V30 END ATOM', 'M  V30 BEGIN BOND', 'M  V30 1 1 1 2', 'M  V30 2 1 1 3',
  'M  V30 3 2 3 4', 'M  V30 4 1 1 5', 'M  V30 5 1 1 6',
  'M  V30 END BOND', 'M  V30 END CTAB', 'M  END', '',
].join('\n');
const chiral = [
  'Chiral graph', 'Burette', '', '  0  0  0     0  0            999 V3000',
  'M  V30 BEGIN CTAB', 'M  V30 COUNTS 5 4 0 0 0', 'M  V30 BEGIN ATOM',
  'M  V30 1 C 0 0 0 0 CFG=2', 'M  V30 2 N 1 0 0 0 CHG=1', 'M  V30 3 O 2 0 0 0',
  'M  V30 4 F 0 1 1 0', 'M  V30 5 Cl 0 -1 1 0', 'M  V30 END ATOM', 'M  V30 BEGIN BOND',
  'M  V30 1 1 1 2', 'M  V30 2 2 2 3', 'M  V30 3 1 1 4 CFG=1', 'M  V30 4 1 1 5',
  'M  V30 END BOND', 'M  V30 END CTAB', 'M  END', '',
].join('\n');
const workerURL = new URL('../apps/desktop/src/lib/molecular-workbench/graph-worker.ts', import.meta.url);
const identity = (length: number) => Array.from({ length }, (_, index) => index);

test('the real focused worker parses source order and composes one edit sequence atomically', async () => {
  const parsed = await runGraphTask({ action: 'parse', source: interleaved + '$$$$\n', format: 'sdf' });
  expect(parsed.atoms).toEqual([
    { element: 'C', x: 0, y: 0, z: 0 }, { element: 'H', x: -1, y: 0, z: 0 },
    { element: 'N', x: 1, y: 0, z: 0 }, { element: 'O', x: 2, y: 0, z: 0 },
    { element: 'F', x: 0, y: 1, z: 1 }, { element: 'F', x: 0, y: -1, z: 1 },
  ]);
  const before = structuredClone(parsed);
  const result = await runGraphTask({ action: 'edit-graph', molecule: parsed, edits: [
    { kind: 'add-atom', element: 'Na', position: [4, 3, 2] },
    { kind: 'delete-atoms', indices: [1] },
    { kind: 'reorder-atoms', order: [5, 0, 1, 2, 3, 4] },
  ] });
  expect(result.sourceAtomIndices).toEqual([-1, 0, 2, 3, 4, 5]);
  expect(result.atoms.map(atom => atom.element)).toEqual(['Na', 'C', 'N', 'O', 'F', 'F']);
  const mol = Molecule.fromMolfile(result.molfile);
  expect([mol.getAtomCharge(result.atomMap![2]), mol.getAtomMass(result.atomMap![1]), result.bonds.map(bond => bond.order).sort()]).toEqual([1, 13, [1, 1, 1, 2]]);
  await expect(runGraphTask({ action: 'edit-graph', molecule: parsed, edits: [
    { kind: 'update-atom', index: 0, isotope: 14 }, { kind: 'delete-atoms', indices: [99] },
  ] })).rejects.toThrow('Invalid atom index');
  expect(parsed).toEqual(before);
  await expect(runGraphTask({ action: 'edit-graph', molecule: parsed, edits: [] })).rejects.toThrow('1–16');
});

test('coordinate helpers retain raw stereo and chemical identity through the real worker', async () => {
  const parsed = await runGraphTask({ action: 'parse', source: chiral, format: 'mol' });
  const normalized = await runGraphTask({ action: 'edit-graph', molecule: parsed, edits: [{ kind: 'reorder-atoms', order: identity(parsed.atoms.length) }] });
  const coordinates: Vec3[] = normalized.atoms.map(atom => [atom.x + 0.1234567891, atom.y - 2, atom.z + 1]);
  const patched = molfileWithPositions(normalized.molfile, coordinates);
  const stripCoordinates = (text: string) => text.split('\n').map(row => row.replace(/^(M  V30 \d+ \S+ )\S+ \S+ \S+( .*)$/u, '$1<coordinates>$2'));
  expect(stripCoordinates(patched)).toEqual(stripCoordinates(normalized.molfile));
  const moved = await runGraphTask({ action: 'parse', source: patched, format: 'mol' });
  const after = await runGraphTask({ action: 'edit-graph', molecule: moved, edits: [{ kind: 'reorder-atoms', order: identity(moved.atoms.length) }] });
  expect(() => checkPositionsOnlyEdit(normalized, after, coordinates)).not.toThrow();
  expect(atomAnnotations(after.molfile)).toEqual(atomAnnotations(normalized.molfile));
  expect(after.molfile.match(/CFG=\d+/gu)).toEqual(normalized.molfile.match(/CFG=\d+/gu));
  expect(() => checkPositionsOnlyEdit(normalized, { ...after, bonds: after.bonds.slice(1) }, coordinates)).toThrow('chemically');
  expect(() => molfileWithPositions(normalized.molfile, [[NaN, 0, 0], ...coordinates.slice(1)])).toThrow('finite');
});

test('shared dispatcher preserves XYZ parse and rejects unsupported or oversized edit sequences', () => {
  const water = runGraphOperation({ action: 'parse', source: '3\nwater\nH .95 0 0\nO 0 0 0\nH -.23 .93 0', format: 'xyz' });
  expect([water.graphSource, water.graphComplete, water.atoms.map(atom => atom.element)]).toEqual(['perceived', true, ['H', 'O', 'H']]);
  expect(() => runGraphOperation({ action: 'edit-graph', molecule: water, edits: [] })).toThrow('1–16');
  expect(() => runGraphOperation({ action: 'edit-graph', molecule: water, edits: Array.from({ length: 17 }, () => ({ kind: 'delete-atoms', indices: [0] })) })).toThrow('1–16');
});

test('the worker keeps the explicit rejection of annotated chiral groups with interleaved hydrogen', async () => {
  const source = interleaved.replace('MASS=13', 'MASS=13 CFG=2').replace('M  V30 6 F', 'M  V30 6 Cl');
  const parsed = await runGraphTask({ action: 'parse', source, format: 'mol' });
  await expect(runGraphTask({ action: 'edit-graph', molecule: parsed, edits: [
    { kind: 'reorder-atoms', order: identity(parsed.atoms.length) },
  ] })).rejects.toThrow('Reordering annotated atom groups');
});

test('real private workers terminate on completion, cancellation, timeout and serialization failure', async () => {
  let terminated = 0, created = 0;
  const create = () => {
    created++;
    const worker = new Worker(workerURL, { type: 'module' }), terminate = worker.terminate.bind(worker);
    worker.terminate = () => { terminated++; terminate(); };
    return worker;
  };
  const request = { action: 'parse', source: interleaved, format: 'mol' };
  await runWorkerTask(create, request);
  const controller = new AbortController(), pending = runWorkerTask(create, request, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await expect(runWorkerTask(create, request, { timeoutMs: 0 })).rejects.toThrow('time limit');
  await expect(runWorkerTask(create, { uncloneable: () => {} })).rejects.toThrow();
  await expect(runWorkerTask(create, request, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect({ created, terminated }).toEqual({ created: 4, terminated: 4 });
});

test('browser worker bundle resolves no Burette forcefield, optimizer, quantum or symmetry runtime', async () => {
  const imports: string[] = [];
  const build = await Bun.build({ entrypoints: [workerURL.pathname], target: 'browser', format: 'esm', plugins: [{
    name: 'review-worker-imports', setup(builder) { builder.onResolve({ filter: /.*/u }, args => { imports.push(args.path); return undefined; }); },
  }] });
  expect(build.success).toBe(true);
  expect(build.outputs.length).toBeGreaterThan(0);
  expect(imports.filter(path => /(?:^|\/)(?:chemistry|compute-worker|compute-client|forcefield|uff-wasm|optimization|minimizer|quantum|symmetry|builders|zmatrix[^/]*)(?:[./]|$)/u.test(path))).toEqual([]);
});

import { expect, mock, test } from 'bun:test';
import { atomsFromZmatrixDocument, parseZmatrixDocument } from '../scripts/zmatrix-document.mjs';
import { measureGeometry } from '../scripts/molecular-geometry.js';
import { createLennardJonesEvaluator } from '../apps/desktop/src/lib/molecular-workbench/energy-models';
import type { AsyncEnergyEvaluator } from '../apps/desktop/src/lib/molecular-workbench/optimization';
import type { MolecularAtom } from '../apps/desktop/src/lib/molecular-workbench/types';

// An external program as the native energy_models commands present it: Lennard-Jones
// over the session's elements, with its analytic Cartesian gradient.
type Args = Record<string, any>;
const PAIR = 'avogadro:pair-energy/lennard-jones';
const calls: string[] = [];
const sessions = new Map<string, string[]>();
let opened = 0;
async function native(command: string, args?: Args): Promise<unknown> {
  calls.push(command);
  if (command === 'energy_models_list') return [{ id: PAIR, name: 'Pair model', description: '', source: 'pair-energy', inputFormat: null,
    gradients: true, ions: true, radicals: true, unitCell: false, elements: [1, 6, 8], unavailable: null }];
  if (command === 'energy_model_open') { const id = `session-${++opened}`; sessions.set(id, args!.request.elements); return id; }
  if (command === 'energy_model_close') { sessions.delete(args!.session); return null; }
  const elements = sessions.get(args!.session);
  if (!elements) throw new Error('The energy model session is closed.');
  await new Promise(resolve => setTimeout(resolve, 1));
  const x: number[] = args!.coordinates, atoms = elements.map((element, i) => ({ element, x: x[3 * i], y: x[3 * i + 1], z: x[3 * i + 2] }));
  const model = createLennardJonesEvaluator(elements);
  return { energy: model.energy(atoms), gradient: model.gradient!(atoms).flat() };
}
mock.module('@tauri-apps/api/core', () => ({ invoke: native }));

const { parseMolecule } = await import('../apps/desktop/src/lib/molecular-workbench/chemistry');
const { serializeXyz } = await import('../apps/desktop/src/lib/molecular-workbench/xyz');
const { optimizeZmatrix } = await import('../apps/desktop/src/lib/workbench/zmatrix-coupled-optimization');
const { optimizeZmatrixAsync } = await import('../apps/desktop/src/lib/workbench/zmatrix-chain-rule-optimization');
const { refreshExternalEnergyModels } = await import('../apps/desktop/src/lib/molecular-workbench/external-energy-models');
const { optimizeZmatrixWithEnergyModel } = await import('../apps/desktop/src/lib/molecular-workbench/optimize-with-model');

// Lennard-Jones water: every pair has its minimum at the sum of the van der Waals radii,
// O–H 1.5 + 1.2 Å and H–H 2.4 Å, and that triangle exists, so the minimum is −3ε.
const water = 'O\nX 1 1\nH 1 R 2 A\nH 1 R 2 A 3 180\n\nR = 2.3\nA = 35\n';
const DEPTH = 100 / 4.184;
// Rows O, X, H, H place atoms O, H, H.
const ATOM_OF_ROW = [0, null, 1, 2];
function source(text: string) {
  const definition = parseZmatrixDocument(text), placed = atomsFromZmatrixDocument(definition);
  // A rotated, translated input. Freezes refer to the physical source frame.
  const atoms = placed.map(({ element, position: [x, y, z] }) => ({ element, x: 4 - z, y: -2 + x, z: 8 - y }));
  return { definition, molecule: parseMolecule(serializeXyz(atoms), 'xyz') };
}
const length = (atoms: MolecularAtom[], a: number, b: number) => measureGeometry('distance', [a, b].map(i => ({ id: String(i), position: [atoms[i].x, atoms[i].y, atoms[i].z] }))).value as number;
const variable = (definition: { variables: { name: string; value: number }[] }, name: string) => definition.variables.find(item => item.name === name)!.value;

/** The test's own asynchronous model, counting what the optimizer asks of it. */
function pairModel(elements: string[]) {
  const model = createLennardJonesEvaluator(elements);
  const evaluator = {
    evaluations: 0, disposed: 0,
    async evaluate(atoms: MolecularAtom[]) {
      evaluator.evaluations++;
      await Promise.resolve();
      return { energy: model.energy(atoms), gradient: model.gradient!(atoms) };
    },
    dispose() { evaluator.disposed++; },
  } satisfies AsyncEnergyEvaluator & { evaluations: number; disposed: number };
  return evaluator;
}

for (const [label, options] of [
  ['free', {}],
  ['a frozen row and a held angle', { frozenRows: [2], lockedCoordinates: ['2:1'] }],
  ['two frozen rows', { frozenRows: [2, 3] }],
] as const) test(`one model evaluation per point reaches the worker's minimum with ${label}`, async () => {
  const { definition, molecule } = source(water), original = structuredClone({ definition, molecule });
  const model = pairModel(molecule.atoms.map(atom => atom.element)), steps: number[] = [];
  const result = await optimizeZmatrixAsync(molecule, definition, model, PAIR, { method: 'lbfgs', maxIterations: 300, ...options }, step => steps.push(step.energy));
  const reference = optimizeZmatrix(molecule, definition, { method: 'lbfgs', maxIterations: 300, forceField: 'LJ', ...options });
  expect([result.forceField, result.gradient, result.converged, reference.converged]).toEqual([PAIR, 'chain-rule', true, true]);
  expect(result.energy).toBeCloseTo(reference.energy, 6);
  // The angle and torsion trade off along a valley of equal energy; the shared bond does not.
  expect(variable(result.definition, 'R')).toBeCloseTo(variable(reference.definition, 'R'), 4);
  expect(length(result.molecule.atoms, 1, 2)).toBeCloseTo(length(reference.molecule.atoms, 1, 2), 4);
  expect(result.energy).toBeCloseTo(createLennardJonesEvaluator(['O', 'H', 'H']).energy(result.molecule.atoms), 10);
  expect(steps).toEqual(result.frames!.slice(1, 1 + result.iterations).map(frame => frame.energy));
  expect(result.frames![0]).toEqual({ atoms: molecule.atoms, energy: result.initialEnergy });
  for (const frame of result.frames!) {
    for (const row of options.frozenRows ?? []) expect(frame.atoms[ATOM_OF_ROW[row]!]).toEqual(molecule.atoms[ATOM_OF_ROW[row]!]);
    expect(length(frame.atoms, 0, 1)).toBeCloseTo(length(frame.atoms, 0, 2), 9);
  }
  if (label === 'free') {
    expect(result.energy).toBeCloseTo(-3 * DEPTH, 6);
    expect(variable(result.definition, 'R')).toBeCloseTo(2.7, 5);
    expect(length(result.molecule.atoms, 1, 2)).toBeCloseTo(2.4, 5);
  }
  if (label === 'a frozen row and a held angle') expect(variable(result.definition, 'A')).toBe(35);
  if (label === 'two frozen rows') expect(length(result.molecule.atoms, 1, 2)).toBeCloseTo(length(molecule.atoms, 1, 2), 9);
  expect(model.disposed).toBe(0);
  expect({ definition, molecule }).toEqual(original);
});

test('a FIRE step evaluates the start once and the trial once; differencing would take one per variable side', async () => {
  const { definition, molecule } = source(water);
  const model = pairModel(molecule.atoms.map(atom => atom.element));
  const result = await optimizeZmatrixAsync(molecule, definition, model, PAIR, { method: 'fire', maxIterations: 1 });
  expect([result.iterations, model.evaluations]).toEqual([1, 2]);
  expect(result.energy).toBeLessThan(result.initialEnergy);
  // Locking every coordinate leaves nothing to move: the start is the result.
  const held = pairModel(molecule.atoms.map(atom => atom.element));
  const still = await optimizeZmatrixAsync(molecule, definition, held, PAIR, { lockedCoordinates: ['2:0', '2:1', '3:2'] });
  expect([still.stopReason, still.molecule.atoms, still.energy, held.evaluations]).toEqual(['no-variables', molecule.atoms, still.initialEnergy, 1]);
});

test('the Z-matrix entry point runs an external model over one session, and Cancel closes it mid-run', async () => {
  await refreshExternalEnergyModels(native as never);
  const { definition, molecule } = source(water);
  calls.length = 0;
  const result = await optimizeZmatrixWithEnergyModel(molecule, definition, PAIR, { method: 'lbfgs', maxIterations: 300, frozenRows: [0] });
  expect([result.forceField, result.gradient, result.converged, result.molecule.atoms[0]]).toEqual([PAIR, 'chain-rule', true, molecule.atoms[0]]);
  expect(calls.filter(command => command === 'energy_model_open')).toHaveLength(1);
  expect(calls.filter(command => command === 'energy_model_close')).toHaveLength(1);

  calls.length = 0;
  const controller = new AbortController();
  const run = optimizeZmatrixWithEnergyModel(molecule, definition, PAIR, { method: 'fire', maxIterations: 500 }, { signal: controller.signal, onProgress: () => controller.abort() });
  await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls.filter(command => command === 'energy_model_close')).toHaveLength(1);
  expect(sessions.size).toBe(0);
  await expect(optimizeZmatrixWithEnergyModel(molecule, definition, PAIR, {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls.filter(command => command === 'energy_model_open')).toHaveLength(1);
});

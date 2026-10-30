import { expect, test } from 'bun:test';
import { atomsFromZmatrixDocument, parseZmatrixDocument } from '../scripts/zmatrix-document.mjs';
import { measureGeometry } from '../scripts/molecular-geometry.js';
import { getEnergy, optimize, parseMolecule } from '../apps/desktop/src/lib/molecular-workbench/chemistry';
import { optimizeZmatrix } from '../apps/desktop/src/lib/workbench/zmatrix-coupled-optimization';
import { zmatrixOptimizedRevision, zmatrixRowLabels } from '../apps/desktop/src/lib/workbench/zmatrix-draft';
import { serializeXyz } from '../apps/desktop/src/lib/molecular-workbench/xyz';
import { parseScientificFile } from '../apps/desktop/src/lib/molecular-workbench/quantum';

const water = 'O\nX 1 1\nH 1 R 2 A\nH 1 R 2 A 3 180\n\nR = 1.15\nA = 50\n';
function source(text: string) {
  const definition = parseZmatrixDocument(text), placed = atomsFromZmatrixDocument(definition);
  // A rotated, translated input. Freezes refer to the physical source frame.
  const atoms = placed.map(({ element, position: [x, y, z] }) => ({ element, x: 4 - z, y: -2 + x, z: 8 - y }));
  const xyz = serializeXyz(atoms), molecule = parseMolecule(xyz, 'xyz');
  return { definition, molecule, xyz };
}
const points = (atoms: { x: number; y: number; z: number }[], indices: number[]) => indices.map(i => ({ id: String(i), position: [atoms[i].x, atoms[i].y, atoms[i].z] }));
const length = (atoms: Parameters<typeof points>[0], a: number, b: number) => measureGeometry('distance', points(atoms, [a, b])).value;

for (const method of ['lbfgs', 'fire', 'abc-fire', 'hybrid'] as const) test(`${method} optimizes physical water in shared coordinates while preserving a frozen atom`, () => {
  const { definition, molecule } = source(water), original = structuredClone({ definition, molecule });
  const result = optimizeZmatrix(molecule, definition, { method, maxIterations: 200, frozenRows: [2] });
  expect(result.converged).toBe(true);
  expect(result.energy).toBeLessThan(result.initialEnergy - 20);
  expect(result.energy).toBeCloseTo(getEnergy(result.molecule), 10);
  // MMFF94 water's equilibrium bond is 0.969 Å; the angle is 103.978 degrees.
  expect(length(result.molecule.atoms, 0, 1)).toBeCloseTo(.969, 5);
  expect(measureGeometry('angle', points(result.molecule.atoms, [1, 0, 2])).value).toBeCloseTo(103.978, 2);
  expect(result.definition.rows).toEqual(definition.rows);
  for (const frame of result.frames!) {
    expect(frame.atoms[1]).toEqual(molecule.atoms[1]);
    expect(length(frame.atoms, 0, 1)).toBeCloseTo(length(frame.atoms, 0, 2), 9);
  }
  expect({ definition, molecule }).toEqual(original);
});

test('chemically different shared bonds reach a constrained compromise instead of detaching', () => {
  const { definition, molecule } = source('N\nH 1 R\nH 1 R 2 107\nCl 1 R 2 107 3 120\n\nR = 1.2\n');
  const coupled = optimizeZmatrix(molecule, definition, { maxIterations: 100 });
  const free = optimize(molecule);
  expect(coupled.converged).toBe(true);
  expect(coupled.energy).toBeLessThan(coupled.initialEnergy - 100);
  expect(coupled.energy).toBeGreaterThan(free.energy + 100);
  expect(Math.abs(length(free.molecule.atoms, 0, 1) - length(free.molecule.atoms, 0, 3))).toBeGreaterThan(.5);
  const r = coupled.definition.variables[0].value;
  for (const i of [1, 2, 3]) expect(length(coupled.molecule.atoms, 0, i)).toBeCloseTo(r, 9);
  expect(coupled.definition.rows.slice(1).map(row => row.values[0])).toEqual(['R', 'R', 'R']);
  // Independent central derivative of physical energy along the single shared
  // length, with all angles held at the optimized definition.
  const energyAt = (r: number) => {
    const doc = { ...coupled.definition, variables: [{ name: 'R', value: r }] };
    const atoms = atomsFromZmatrixDocument(doc).map(({ element, position: [x, y, z] }) => ({ element, x, y, z }));
    return getEnergy({ ...molecule, atoms });
  };
  expect(Math.abs((energyAt(r + 1e-5) - energyAt(r - 1e-5)) / 2e-5)).toBeLessThan(1e-3);
});

test('holding one use holds the whole variable, including coordinates measured from a dummy', () => {
  const { definition, molecule } = source(water);
  const result = optimizeZmatrix(molecule, definition, { lockedCoordinates: ['3:0', '2:1'] });
  expect(result.definition).toEqual(definition);
  for (const i of [1, 2]) expect(length(result.molecule.atoms, 0, i)).toBeCloseTo(1.15, 10);
  expect(result.converged).toBe(true);
  expect(result.energy).toBeCloseTo(result.initialEnergy, 10);
  expect(result.molecule.atoms).toEqual(molecule.atoms);
  const text = serializeXyz(molecule.atoms);
  const science = { ...parseScientificFile('water.xyz', text), internalCoordinates: definition };
  const written = zmatrixOptimizedRevision(science, definition, result.molecule.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] })), zmatrixRowLabels(definition), text, [{ text, document: science }], result.definition);
  expect(written.revision).toEqual({ text, document: science, topology: undefined });
});

test('two frozen hydrogens permit the oxygen and the coupled variables to relax', () => {
  const { definition, molecule } = source(water);
  const result = optimizeZmatrix(molecule, definition, { frozenRows: [2, 3], maxIterations: 150 });
  expect(result.converged).toBe(true);
  expect(result.energy).toBeLessThan(result.initialEnergy - 15);
  expect(result.molecule.atoms.slice(1)).toEqual(molecule.atoms.slice(1));
  expect(result.molecule.atoms[0]).not.toEqual(molecule.atoms[0]);
  expect(length(result.molecule.atoms, 0, 1)).toBeCloseTo(length(result.molecule.atoms, 0, 2), 9);
  // Independently sample nearby oxygen positions on the symmetry axis: the
  // accepted point is stationary with the exact Cartesian freezes.
  for (const shift of [-.001, .001]) {
    const atoms = result.molecule.atoms.map((atom, i) => i ? atom : { ...atom, x: atom.x + shift });
    expect(getEnergy({ ...molecule, atoms })).toBeGreaterThan(result.energy);
  }
});

test('signed torsions stay coupled through periodic equivalents and are measured on every frame', () => {
  const text = 'C\nX 1 1\nH 1 R 2 A\nH 1 R 2 A 3 D\nH 1 R 2 A 3 -D\nH 1 R 2 180 3 0\n\nR = 1.15\nA = 70\nD = 110\n';
  const { definition, molecule } = source(text);
  const result = optimizeZmatrix(molecule, definition, { maxIterations: 200 });
  expect(result.energy).toBeLessThan(result.initialEnergy);
  expect(result.definition.rows.map(row => row.values)).toEqual(definition.rows.map(row => row.values));
  expect(Math.abs(result.definition.variables.find(v => v.name === 'D')!.value)).toBeCloseTo(120, 3);
  for (const { atoms } of result.frames!) {
    // D and -D are the H2–C–dummy–H1 torsions. Their difference is
    // independently visible as opposite signed volumes about the C–dummy axis.
    const centre = atoms[0];
    expect(atoms[2].z - centre.z).toBeCloseTo(-(atoms[3].z - centre.z), 8);
  }
  const peroxide = 'O\nO 1 1.45\nH 1 .97 2 100\nH 2 .97 1 100 3 D\n\nD = 180\n';
  const plus = source(peroxide), minus = source(peroxide.replace('D = 180', 'D = -180'));
  expect(getEnergy(plus.molecule)).toBeCloseTo(getEnergy(minus.molecule), 10);
  for (const state of [plus, minus]) {
    const periodic = optimizeZmatrix(state.molecule, state.definition, { lockedCoordinates: ['1:0', '2:0', '2:1', '3:0', '3:1'] });
    expect(periodic.energy).toBeCloseTo(getEnergy(state.molecule), 8);
    expect(periodic.definition.rows[3].values[2]).toBe('D');
  }
});

test('a coupled result writes one exact definition revision and preserves the original for Undo', () => {
  const { definition, molecule, xyz } = source(water);
  const science = { ...parseScientificFile('water.xyz', xyz), internalCoordinates: definition };
  const revisions = [{ text: xyz, document: science }];
  const result = optimizeZmatrix(molecule, definition);
  const atoms = result.molecule.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] }));
  const written = zmatrixOptimizedRevision(science, definition, atoms, zmatrixRowLabels(definition), xyz, revisions, result.definition);
  expect(written.revision.document.internalCoordinates).toEqual(result.definition);
  expect(written.revision.document.atoms).toEqual(result.molecule.atoms);
  expect(written.detachedBindings).toEqual([]);
  expect(revisions).toEqual([{ text: xyz, document: science }]);
  expect(science.internalCoordinates).toEqual(definition);
});

test('invalid freezes, locks, geometry and limits fail without changing the input', () => {
  const { definition, molecule } = source(water);
  expect(() => optimizeZmatrix(molecule, definition, { frozenRows: [1] })).toThrow('Only real atom');
  expect(() => optimizeZmatrix(molecule, definition, { lockedCoordinates: ['5:2'] })).toThrow('no longer exists');
  expect(() => optimizeZmatrix(molecule, definition, { maxIterations: 0 })).toThrow('iteration limit');
  const moved = { ...molecule, atoms: molecule.atoms.map((atom, i) => i === 2 ? { ...atom, x: atom.x + .1 } : atom) };
  expect(() => optimizeZmatrix(moved, definition)).toThrow('no longer matches');
});

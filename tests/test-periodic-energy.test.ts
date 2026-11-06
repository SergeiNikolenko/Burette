import { expect, test } from 'bun:test';
import { createLennardJonesEvaluator, resolveEnergyModel } from '../apps/desktop/src/lib/molecular-workbench/energy-models';
import { getEnergy, optimize, parseMolecule } from '../apps/desktop/src/lib/molecular-workbench/chemistry';

const LATTICE = 'Lattice="10 0 0 0 10 0 0 0 10"';
const argon = (x: number) => parseMolecule(`2\n${LATTICE} Ar2\nAr 1 0 0\nAr ${x} 0 0\n`, 'xyz');

test('an extended XYZ Lattice becomes the structure cell, and Lennard-Jones pairs take their minimum image', () => {
  const periodic = argon(8);
  expect(periodic.cell).toEqual([[10, 0, 0], [0, 10, 0], [0, 0, 10]]);
  // Atoms 7 Å apart inside the cell are 3 Å apart across its boundary.
  const isolated = parseMolecule('2\nAr2\nAr 0 0 0\nAr 3 0 0\n', 'xyz');
  expect(isolated.cell).toBeUndefined();
  expect(getEnergy(periodic, 'LJ')).toBeCloseTo(getEnergy(isolated, 'LJ'), 10);
  // A triclinic cell: the analytic gradient is the derivative of the periodic energy.
  const cell: [[number, number, number], [number, number, number], [number, number, number]] = [[6, 0, 0], [2, 5.5, 0], [1, 1.5, 7]];
  const atoms = [{ element: 'Ar', x: 0.2, y: 0.3, z: 0.1 }, { element: 'Ar', x: 5.1, y: 4.9, z: 6.2 }, { element: 'Kr', x: 3.1, y: 0.4, z: 3.3 }];
  const field = createLennardJonesEvaluator(atoms.map(atom => atom.element), cell), h = 1e-6;
  const gradient = field.gradient!(atoms);
  atoms.forEach((atom, i) => (['x', 'y', 'z'] as const).forEach((axis, k) => {
    const moved = (delta: number) => field.energy(atoms.map((other, j) => j === i ? { ...other, [axis]: other[axis] + delta } : other));
    expect(gradient[i][k]).toBeCloseTo((moved(h) - moved(-h)) / (2 * h), 5);
  }));
});

test('optimization relaxes a periodic pair across the cell boundary and keeps the cell', () => {
  const result = optimize(argon(8), { forceField: 'LJ' });
  const [a, b] = result.molecule.atoms, separation = Math.abs(b.x - a.x);
  // The minimum is at the summed Alvarez radii of the nearest image.
  expect(Math.min(separation, 10 - separation)).toBeCloseTo(2 * 1.83, 4);
  expect(result.converged).toBe(true);
  expect(result.molecule.cell).toEqual([[10, 0, 0], [0, 10, 0], [0, 0, 10]]);
});

test('models without periodic terms refuse a cell, and Automatic picks Lennard-Jones only for unbonded atoms', () => {
  const water = parseMolecule(`3\n${LATTICE} water\nO 0 0 0\nH 0.9572 0 0\nH -0.24 0.927 0\n`, 'xyz');
  expect(water.bonds.length).toBe(2);
  expect(() => resolveEnergyModel('auto', water)).toThrow('No built-in model has periodic terms for bonded atoms');
  expect(resolveEnergyModel('auto', argon(8))).toBe('LJ');
  expect(() => getEnergy(water, 'UFF')).toThrow('UFF has no periodic terms');
  expect(() => optimize(water, { forceField: 'MMFF94' })).toThrow('MMFF94 has no periodic terms');
});

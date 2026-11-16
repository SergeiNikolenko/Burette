import { expect, test } from 'bun:test';
import { createLennardJonesEvaluator, energyModelUnavailable, resolveEnergyModel } from '../apps/desktop/src/lib/molecular-workbench/energy-models';
import { generateFromSmiles, getEnergy, optimize, parseMolecule } from '../apps/desktop/src/lib/molecular-workbench/chemistry';

const distance = (a: { x: number; y: number; z: number }, b: typeof a) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
// ε = 100 kJ/mol in kcal/mol; each pair's minimum lies at the sum of its Alvarez radii.
const DEPTH = 100 / 4.184;

test('Lennard-Jones relaxes XYZ input without bond orders to the pair minima of Avogadro\'s model', () => {
  const argon = parseMolecule('3\nAr3\nAr 0 0 0\nAr 3.1 0.4 0\nAr 1.2 2.9 0.3\n', 'xyz');
  expect(() => getEnergy(argon, 'UFF')).toThrow('bond orders');
  const result = optimize(argon, { forceField: 'LJ' });
  const [a, b, c] = result.molecule.atoms;
  expect([result.method, result.stopReason]).toEqual(['lbfgs', 'converged']);
  for (const [p, q] of [[a, b], [b, c], [a, c]]) expect(distance(p, q)).toBeCloseTo(2 * 1.83, 4);
  expect(result.energy).toBeCloseTo(-3 * DEPTH, 6);
  expect(getEnergy(result.molecule, 'LJ')).toBeCloseTo(result.energy, 9);
});

test('the Lennard-Jones gradient is the derivative of its energy, every pair included', () => {
  const atoms = [['Pt', 0, 0, 0], ['Cl', 2.31, 0.2, -0.1], ['Cl', -0.3, 2.28, 0.15], ['H', 1.1, 1.3, 1.9]].map(([element, x, y, z]) => ({ element: element as string, x: x as number, y: y as number, z: z as number }));
  const field = createLennardJonesEvaluator(atoms.map(atom => atom.element)), h = 1e-6;
  const analytic = field.gradient!(atoms);
  atoms.forEach((atom, i) => (['x', 'y', 'z'] as const).forEach((axis, k) => {
    const shifted = (delta: number) => field.energy(atoms.map((other, j) => j === i ? { ...other, [axis]: other[axis] + delta } : other));
    expect(analytic[i][k]).toBeCloseTo((shifted(h) - shifted(-h)) / (2 * h), 4);
  }));
});

test('Automatic takes MMFF94, then UFF, and Lennard-Jones only for structures without bonds', () => {
  const atoms = (symbols: string) => symbols.split(' ').map(element => ({ element }));
  expect(energyModelUnavailable('MMFF94s', atoms('Sn C H'))).toBe('MMFF94s has no parameters for Sn.');
  expect(energyModelUnavailable('UFF', atoms('Og C'))).toBe('UFF has no parameters for Og.');
  expect(energyModelUnavailable('LJ', atoms('Og C'))).toBeNull();
  expect(resolveEnergyModel('auto', generateFromSmiles('CCO'))).toBe('MMFF94');
  expect(resolveEnergyModel('auto', generateFromSmiles('C[Sn](C)(C)C'))).toBe('UFF');
  // XYZ: a bond-free cluster gets Lennard-Jones; bonds without a complete graph are refused.
  const argon = parseMolecule('2\nAr2\nAr 0 0 0\nAr 3.0 0.2 0\n', 'xyz');
  expect([argon.graphComplete, resolveEnergyModel('auto', argon), resolveEnergyModel('UFF', argon)]).toEqual([false, 'LJ', 'UFF']);
  const ethanol = parseMolecule('9\nethanol\nC -0.0017 1.0861 0.0083\nC 1.5111 1.0863 -0.0081\nO 1.9883 2.4202 0.0120\nH -0.3769 0.0627 -0.0060\nH -0.3817 1.5833 -0.8898\nH -0.3700 1.5986 0.9022\nH 1.8870 0.5735 0.8838\nH 1.8754 0.5584 -0.8996\nH 2.9559 2.3962 0.0016\n', 'xyz');
  expect(resolveEnergyModel('auto', ethanol)).toBe('MMFF94');
  const radical = parseMolecule('4\nmethyl\nC 0 0 0\nH 1.08 0 0\nH -0.54 0.935 0\nH -0.54 -0.935 0\n', 'xyz');
  expect(radical.graphComplete).toBe(false);
  expect(() => resolveEnergyModel('auto', radical)).toThrow('choose Lennard-Jones for a non-bonded cluster');
});

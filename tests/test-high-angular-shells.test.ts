import { expect, test } from 'bun:test';
import { parseScientificFile } from '../apps/desktop/src/lib/molecular-workbench/quantum';
import { evaluateDensityGrid, evaluateOrbital } from '../apps/desktop/src/lib/molecular-workbench/gaussian';
import type { GaussianShell, ScientificDocument } from '../apps/desktop/src/lib/molecular-workbench/scientific-types';
import type { Vec3 } from '../apps/desktop/src/lib/molecular-workbench/types';
import { fixtureText } from './quantum-output-fixture';

// SciPy's spherical harmonics, independently normalized (real-solid-harmonics.py).
const oracle: { exponent: number; pointsBohr: Vec3[]; shells: { l: number; m: number[]; values: number[][] }[] } = JSON.parse(fixtureText('real-solid-harmonics.json'));
const BOHR = 0.529177210903;
const KINDS = ['s', 'p', 'd', 'f', 'g', 'h', 'i'] as const;
const angstrom = (point: Vec3) => point.map(value => value * BOHR) as Vec3;
/** One shell on a hydrogen at the origin, with one orbital per basis function. */
const single = (shell: GaussianShell, size: number): ScientificDocument => ({ format: 'fchk', atoms: [{ element: 'H', x: 0, y: 0, z: 0 }], frames: [], modes: [], basis: [shell],
  orbitals: Array.from({ length: size }, (_, index) => ({ index, energyHartree: -0.5, occupancy: 1, spin: 'alpha', coefficients: Array.from({ length: size }, (_, i) => Number(i === index)) })) });

test('pure d through i shells match SciPy real solid harmonics with their phases', () => {
  for (const { l, values } of oracle.shells) {
    const document = single({ atomIndex: 0, kind: KINDS[l], spherical: true, cartesianOrder: 'gaussian', exponents: [oracle.exponent], coefficients: [1] }, 2 * l + 1);
    oracle.pointsBohr.forEach((point, p) => values[p].forEach((expected, m) => expect(Math.abs(evaluateOrbital(document, m, angstrom(point)) - expected)).toBeLessThan(1e-12)));
  }
});

/** A one-shell, one-orbital FCHK in Gaussian's formatted-checkpoint layout. */
function fchk(type: number, size: number, coefficient: number) {
  const fields: [string, 'I' | 'R', number | number[]][] = [
    ['Number of atoms', 'I', 1], ['Number of alpha electrons', 'I', 1], ['Number of beta electrons', 'I', 1], ['Number of basis functions', 'I', size],
    ['Atomic numbers', 'I', [1]], ['Current cartesian coordinates', 'R', [0, 0, 0]], ['Shell types', 'I', [type]], ['Number of primitives per shell', 'I', [1]],
    ['Shell to atom map', 'I', [1]], ['Primitive exponents', 'R', [oracle.exponent]], ['Contraction coefficients', 'R', [1]], ['Alpha Orbital Energies', 'R', [-0.5]],
    ['Alpha MO coefficients', 'R', Array.from({ length: size }, (_, i) => Number(i === coefficient))],
  ];
  return 'One shell\nSP RHF test\n' + fields.map(([key, kind, value]) => `${key.padEnd(40)}   ${kind}   ${Array.isArray(value) ? `N=${String(value.length).padStart(12)}\n ${value.join(' ')}` : String(value).padStart(12)}`).join('\n') + '\n';
}

test('FCHK pure shells keep m order through i and Cartesian g–i follow the FCHK, not the Molden, order', () => {
  for (let l = 2; l <= 6; l++) {
    const shell = oracle.shells.find(item => item.l === l)!;
    for (let m = 0; m < 2 * l + 1; m++) {
      const document = parseScientificFile('shell.fchk', fchk(-l, 2 * l + 1, m));
      oracle.pointsBohr.forEach((point, p) => expect(Math.abs(evaluateOrbital(document, 0, angstrom(point)) - shell.values[p][m])).toBeLessThan(1e-12));
    }
    // FCHK's first Cartesian function: x^l for f (Molden order), z^l from g on (reversed alphabetic).
    const cartesian = parseScientificFile('shell.fchk', fchk(l, (l + 1) * (l + 2) / 2, 0));
    const [along, across]: Vec3[] = l <= 3 ? [[BOHR, 0, 0], [0, 0, BOHR]] : [[0, 0, BOHR], [BOHR, 0, 0]];
    expect(evaluateOrbital(cartesian, 0, along)).toBeGreaterThan(0);
    expect(evaluateOrbital(cartesian, 0, across)).toBe(0);
  }
});

const molden = (shells: string, flags = '') => `[Molden Format]\n[Atoms] Angs\nH 1 1 0 0 0\n[GTO]\n1 0\n${shells}\n\n${flags}\n[MO]\nSym= A\nEne= -0.5\nSpin= Alpha\nOccup= 1\n1 1\n`;
const shell = (kind: string) => `${kind} 1 1.0\n ${oracle.exponent} 1.0`;

test('Molden d, f and g flags are independent and its Cartesian f and g start with x^l', () => {
  const all = ['d', 'f', 'g'].map(shell).join('\n');
  for (const [flags, functions, spherical] of [
    ['', 31, [false, false, false]], ['[5D]', 27, [true, true, false]], ['[5D10F]', 30, [true, false, false]],
    ['[7F]', 28, [false, true, false]], ['[5D7F]\n[9G]', 21, [true, true, true]], ['[9G]', 25, [false, false, true]],
  ] as const) {
    const document = parseScientificFile('shells.molden', molden(all, flags));
    expect([document.orbitals[0].coefficients.length, document.basis!.map(item => item.spherical)]).toEqual([functions, [...spherical]]);
  }
  for (const kind of ['f', 'g']) {
    const document = parseScientificFile('shell.molden', molden(shell(kind)));
    expect(evaluateOrbital(document, 0, [BOHR, 0, 0])).toBeGreaterThan(0);
    expect([evaluateOrbital(document, 0, [0, BOHR, 0]), evaluateOrbital(document, 0, [0, 0, BOHR])]).toEqual([0, 0]);
  }
  // Pure g in Molden is the same real harmonic as in FCHK.
  const pure = parseScientificFile('shell.molden', molden(shell('g'), '[9G]'));
  const g = oracle.shells.find(item => item.l === 4)!;
  oracle.pointsBohr.forEach((point, p) => expect(Math.abs(evaluateOrbital(pure, 0, angstrom(point)) - g.values[p][0])).toBeLessThan(1e-12));
});

test('expanded high-angular primitives stay within the grid work budget', () => {
  const heavy = single({ atomIndex: 0, kind: 'i', spherical: true, exponents: Array(100).fill(0.7), coefficients: Array(100).fill(0.01) }, 13);
  expect(() => evaluateDensityGrid(heavy, { spacingAngstrom: 0.1, paddingAngstrom: 2 })).toThrow('work limit');
});

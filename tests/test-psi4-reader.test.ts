import { expect, test } from 'bun:test';
import { PSI4_SIGNATURE } from '../apps/desktop/src/lib/molecular-workbench/quantum/signatures';
import { parsePsi4Log } from '../apps/desktop/src/lib/molecular-workbench/quantum/psi4-log';
import { BOHR } from '../apps/desktop/src/lib/molecular-workbench/quantum/reader-values';
import { cclibReference, expectClose, expectGeometries, expectLineEndingsIgnored, expectSchema, expectTruncationsKeepHistory, fixtureText } from './quantum-output-fixture';

// Values Psi4 1.11 held in memory for the same runs that printed the fixtures (generate.py).
const psi4 = JSON.parse(fixtureText('psi4/psi4-reference.json'));
const cclib = cclibReference('psi4');
const read = (name: string) => parsePsi4Log(fixtureText(`psi4/${name}`));

test('Psi4 optimization history and frequency job match the values Psi4 itself computed', () => {
  const text = fixtureText('psi4/water-opt-freq.out');
  expect(PSI4_SIGNATURE.test(text)).toBe(true);
  const document = parsePsi4Log(text), expected = psi4['water-opt-freq.out'];
  expect(document.frames).toHaveLength(expected.optimization.energies.length);
  expectClose(document.frames.map(frame => frame.energyHartree!), expected.optimization.energies, 1e-9);
  document.frames.forEach((frame, i) => expectClose(frame.atoms.flatMap(atom => [atom.x, atom.y, atom.z]), expected.optimization.coordinates_bohr[i].flat().map((value: number) => value * BOHR), 1e-9));
  expect(document.converged).toBe(true);
  expect(Math.abs(document.frames.at(-1)!.energyHartree! - expected.final_energy)).toBeLessThan(1e-9);
  // Psi4 lists only the vibrations of its projected analysis, numbered within all 3N modes.
  const vibrations = expected.frequencies.map((value: number, i: number) => ({ value, i })).filter(({ value }: { value: number }) => value > 1);
  expect(document.modes.map(mode => mode.index)).toEqual(vibrations.map(({ i }: { i: number }) => i));
  expectClose(document.modes.map(mode => mode.frequencyCm1), vibrations.map(({ value }: { value: number }) => value), 5e-5);
  expectClose(document.modes.map(mode => mode.intensityKmMol!), vibrations.map(({ i }: { i: number }) => expected.ir_km_mol[i]), 5e-5);
  expect(document.modes.map(mode => mode.symmetry)).toEqual(['A1', 'A1', 'B2']);
  // Printed displacements (two decimals) are Psi4's normal coordinates, which conserve momentum.
  const masses = expected.masses as number[];
  for (const mode of document.modes) for (let axis = 0; axis < 3; axis++) expect(Math.abs(mode.displacements!.reduce((sum, vector, atom) => sum + masses[atom] * vector[axis], 0))).toBeLessThan(0.05);
  const hessian = document.frames.at(-1)!.hessian!;
  expectClose(Array.from(hessian.values), expected.hessian.flat(), 1e-13);
  expectClose(hessian.massesAmu!, masses, 1e-11);
  expect(document.frames.slice(0, -1).every(frame => !frame.hessian && !frame.modes)).toBe(true);
  const alpha = document.orbitals.filter(orbital => orbital.spin === 'alpha');
  expectClose(alpha.map(orbital => orbital.energyHartree), [...expected.orbitals.alpha].sort((a: number, b: number) => a - b), 5e-7);
  expect(alpha.filter(orbital => orbital.occupancy === 2)).toHaveLength(expected.orbitals.nalpha);
  const charges = document.frames.at(-1)!.charges!;
  expectClose(charges.find(set => set.model === 'mulliken')!.values, expected.mulliken, 5e-6);
  expectClose(charges.find(set => set.model === 'lowdin')!.values, expected.lowdin, 5e-6);
  expectClose(document.frames.at(-1)!.dipoleDebye!, expected.dipole_debye, 5e-7);
  expectSchema(document);
});

test('Psi4 UHF keeps both spin channels with their own occupations', () => {
  const document = read('oh-uhf.out'), expected = psi4['oh-uhf.out'];
  expect(document.frames[0].energyHartree).toBeCloseTo(expected.final_energy, 10);
  for (const spin of ['alpha', 'beta'] as const) {
    const channel = document.orbitals.filter(orbital => orbital.spin === spin);
    expectClose(channel.map(orbital => orbital.energyHartree), [...expected.orbitals[spin]].sort((a: number, b: number) => a - b), 5e-7);
    expect(channel.filter(orbital => orbital.occupancy === 1)).toHaveLength(expected.orbitals[spin === 'alpha' ? 'nalpha' : 'nbeta']);
  }
  expectClose(document.frames[0].charges![0].values, expected.mulliken, 5e-6);
  expectClose(document.frames[0].dipoleDebye!, expected.dipole_debye, 5e-7);
  expectSchema(document);
});

test('Psi4 1.7 correlated energies supersede SCF, as cclib reads them', () => {
  for (const [name, level] of [['cclib-water-mp2.out', 'mp'], ['cclib-water-ccsd.out', 'cc']] as const) {
    const document = read(name), expected = cclib[name];
    expectGeometries(document, expected, 1e-9);
    const correlated = level === 'mp' ? expected.mpenergies![0].at(-1)! : expected.ccenergies![0];
    expect(Math.abs(document.frames[0].energyHartree! - correlated)).toBeLessThan(1e-8);
    expect(Math.abs(document.frames[0].energyHartree! - expected.scfenergies![0])).toBeGreaterThan(0.01);
    expectClose(document.orbitals.map(orbital => orbital.energyHartree), expected.moenergies![0], 1e-6);
    expect(document.orbitals.filter(orbital => orbital.occupancy === 2)).toHaveLength(expected.homos![0] + 1);
  }
});

test('failed and interrupted Psi4 runs stay truthful; malformed tables are refused', () => {
  expect(psi4['water-scf-fail.out'].failed).toBe(true);
  const failed = read('water-scf-fail.out');
  expect(failed.converged).toBe(false);
  expect(failed.frames[0].energyHartree).toBeUndefined();
  const text = fixtureText('psi4/water-opt-freq.out');
  expect(expectTruncationsKeepHistory(text, parsePsi4Log)).toBe(4);
  expect(parsePsi4Log(text.slice(0, text.indexOf('Final optimized geometry'))).converged).toBeUndefined();
  expectLineEndingsIgnored(text, parsePsi4Log);
  const broken = [
    text.replace(/0\.067148923973/u, 'nan'),
    text.replace(/(Center {14}X[^\n]*\n[^\n]*\n {9})O/u, '$1C'),
    text.replace(/IR activ \[km\/mol\]( +)107\.2800/u, 'IR activ [km/mol]$1-107.2800'),
    text.replace(/(\n {6}3 {3}H {16}[-\d. ]+?)  [-\d.]+ *\n/u, '$1\n'),
  ];
  for (const variant of broken) { expect(variant).not.toBe(text); expect(() => parsePsi4Log(variant)).toThrow(); }
});

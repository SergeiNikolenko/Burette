import { expect, test } from 'bun:test';
import { GAMESS_SIGNATURE } from '../apps/desktop/src/lib/molecular-workbench/quantum/signatures';
import { parseGamessLog } from '../apps/desktop/src/lib/molecular-workbench/quantum/gamess-log';
import { evaluateOrbital } from '../apps/desktop/src/lib/molecular-workbench/gaussian';
import type { ScientificDocument } from '../apps/desktop/src/lib/molecular-workbench/scientific-types';
import type { Vec3 } from '../apps/desktop/src/lib/molecular-workbench/types';
import { cclibReference, expectClose, expectGeometries, expectLineEndingsIgnored, expectSchema, expectTruncationsKeepHistory, fixtureText, harmonicFrequencies } from './quantum-output-fixture';

const reference = cclibReference('gamess');
type OrbitalReference = { sha256: string; pointsAngstrom: Vec3[]; spins: { orthonormalityError: number; orbitals: Record<string, number[]> }[] };
const orbitalReference: Record<string, OrbitalReference> = JSON.parse(fixtureText('gamess/orbital-reference.json'));
const read = (name: string) => parseGamessLog(fixtureText(`gamess/${name}`));

/** Orbital amplitudes at fixed points equal PySCF's, from the same coefficients in PySCF's own basis. */
function expectOrbitalValues(document: ScientificDocument, name: string) {
  const expected = orbitalReference[name];
  expected.spins.forEach((spin, s) => {
    // The coefficients are orthonormal in unit-normalized Cartesian AOs to print precision.
    expect(spin.orthonormalityError).toBeLessThan(5e-6);
    const offset = s ? document.orbitals.filter(orbital => orbital.spin === 'alpha').length : 0;
    for (const [number, values] of Object.entries(spin.orbitals)) {
      const orbital = offset + Number(number);
      expect(document.orbitals[orbital].spin).toBe(s ? 'beta' : 'alpha');
      expected.pointsAngstrom.forEach((point, p) => expect(Math.abs(evaluateOrbital(document, orbital, point) - values[p])).toBeLessThanOrEqual(1e-8 * Math.max(1, Math.abs(values[p]))));
    }
  });
}

function expectOrbitalTable(document: ScientificDocument, name: string) {
  const expected = reference[name];
  expected.moenergies!.forEach((energies, s) => {
    const channel = document.orbitals.filter(orbital => orbital.spin === (s ? 'beta' : 'alpha'));
    const printed = energies.filter(Number.isFinite);
    expectClose(channel.map(orbital => orbital.energyHartree), printed, 5e-5); // printed to 1e-4 Eh
    expect(channel.filter(orbital => orbital.occupancy > 0)).toHaveLength(expected.homos![s] + 1);
    expect(channel.map(orbital => orbital.symmetry)).toEqual(expected.mosyms![s].slice(0, printed.length).map(symmetry => symmetry!.toUpperCase()));
    expect(channel.every(orbital => orbital.coefficients.length === expected.nbasis)).toBe(true);
  });
}

test('GAMESS RHF, UHF and correlated outputs match cclib and PySCF orbital values', () => {
  for (const name of ['cclib-dvb_sp.out', 'cclib-dvb_un_sp.out', 'cclib-water_mp2.out', 'cclib-water_ccsd.out']) {
    const text = fixtureText(`gamess/${name}`);
    expect(GAMESS_SIGNATURE.test(text.slice(0, 64 * 1024))).toBe(true);
    const document = parseGamessLog(text), expected = reference[name];
    expectGeometries(document, expected, 1e-9);
    expectOrbitalTable(document, name);
    expectOrbitalValues(document, name);
    const charges = document.frames[0].charges!;
    expectClose(charges.find(set => set.model === 'mulliken')!.values, expected.atomcharges!.mulliken, 1e-9);
    expectClose(charges.find(set => set.model === 'lowdin')!.values, expected.atomcharges!.lowdin, 1e-9);
    expectClose(document.frames[0].dipoleDebye!, expected.dipole_debye!, 1e-9);
    expectSchema(document);
  }
  // MP2 and CCSD total energies supersede the SCF energy of their geometry.
  expect(read('cclib-water_mp2.out').frames[0].energyHartree).toBe(reference['cclib-water_mp2.out'].mpenergies![0][0]);
  expect(read('cclib-water_ccsd.out').frames[0].energyHartree).toBe(reference['cclib-water_ccsd.out'].ccenergies![0]);
  expect(read('cclib-dvb_sp.out').frames[0].energyHartree).toBe(reference['cclib-dvb_sp.out'].scfenergies![0]);
  // The UHF run stopped unconverged: GAMESS prints 0.0 as its "final" energy, which is not a result.
  const radical = read('cclib-dvb_un_sp.out');
  expect([radical.converged, radical.frames[0].energyHartree]).toEqual([false, undefined]);
  expect(radical.orbitals.filter(orbital => orbital.spin === 'beta' && orbital.occupancy === 1)).toHaveLength(34);
});

test('ISPHER=1 high-angular basis keeps Cartesian AOs through g in the printed label order', () => {
  const name = 'cclib-C_bigbasis-trimmed.out', document = read(name);
  expect(document.basis!.map(shell => shell.kind).join('')).toBe('sssssppppdddffgssspppddfspdfg');
  expect(document.basis!.every(shell => !shell.spherical)).toBe(true);
  // 139 Cartesian AOs, 109 spherical-harmonic MOs.
  expect([document.orbitals.length, document.orbitals[0].coefficients.length]).toEqual([109, 139]);
  expectOrbitalTable(document, name);
  expectOrbitalValues(document, name);
});

test('optimization history keeps each step, convergence and the final orbitals', () => {
  const name = 'cclib-dvb_gopt_a.out', text = fixtureText(`gamess/${name}`), document = parseGamessLog(text), expected = reference[name];
  expectGeometries(document, expected, 1e-9);
  expectClose(document.frames.map(frame => frame.energyHartree!), expected.scfenergies!, 1e-10);
  expect(document.converged).toBe(true);
  // MOLECULAR ORBITALS after the final geometry: occupied orbitals and the first virtuals only.
  expectOrbitalTable(document, name);
  expectOrbitalValues(document, name);
  expectSchema(document);
  expect(expectTruncationsKeepHistory(text, parseGamessLog)).toBe(7);
  expect(parseGamessLog(text.slice(0, text.indexOf('EQUILIBRIUM GEOMETRY LOCATED'))).converged).toBeUndefined();
});

test('Hessian, IR and Raman analyses keep vibrations only, with signed imaginary modes', () => {
  const ts = read('cclib-nh3_ts_ir.out'), expected = reference['cclib-nh3_ts_ir.out'];
  expectGeometries(ts, expected, 1e-9);
  // Displaced-geometry SCFs of the numerical Hessian do not replace the reference energy.
  expect(ts.frames[0].energyHartree).toBe(expected.scfenergies![0]);
  expectClose(ts.modes.map(mode => mode.frequencyCm1), expected.vibfreqs!, 1e-9);
  expect(ts.modes.map(mode => mode.index)).toEqual([0, 1, 2, 3, 4, 5]);
  // cclib converts with the rounded 42.255 km/mol per D²/(amu·Å²).
  ts.modes.forEach((mode, m) => expect(Math.abs(mode.intensityKmMol! - expected.vibirs![m] * 42.25606 / 42.255)).toBeLessThan(1e-9));
  ts.modes.forEach((mode, m) => expectClose(mode.displacements!.flat(), expected.vibdisps![m].flat(), 1e-12));
  const hessian = ts.frames[0].hessian!;
  expect([hessian.source, hessian.massesAmu]).toEqual(['gamess-log', [14.00307, 1.00782, 1.00782, 1.00782]]);
  // cclib misreads GAMESS's touching fixed-width force constants; the program's own vibrational
  // frequencies (printed to 0.001 cm⁻¹) check the parsed matrix, its units and the masses instead.
  // Rotations and translations of this unprojected Hessian sit within a few cm⁻¹ of zero.
  const frequencies = harmonicFrequencies(hessian);
  expectClose([frequencies[0], ...frequencies.slice(7)], [-825.176, 1691.242, 1691.286, 3639.715, 3639.782, 3661.476], 0.02);
  expect(frequencies.slice(1, 7).every(value => Math.abs(value) < 70)).toBe(true);
  expect(ts.orbitals).toEqual([]); // semi-empirical AM1: no Gaussian basis
  expectSchema(ts);

  const raman = read('cclib-firefly-dvb_raman.out'), firefly = reference['cclib-firefly-dvb_raman.out'];
  expect(raman.modes).toHaveLength(54);
  expectClose(raman.modes.map(mode => mode.frequencyCm1), firefly.vibfreqs!, 1e-9);
  expectClose(raman.modes.map(mode => mode.ramanActivityAngstrom4Amu!), firefly.vibramans!, 1e-9);
  raman.modes.forEach((mode, m) => expect(Math.abs(mode.intensityKmMol! - firefly.vibirs![m] * 42.25606 / 42.255)).toBeLessThan(1e-9));
  expect(raman.modes.every(mode => mode.ramanDepolarizationRatio! >= 0 && mode.ramanDepolarizationRatio! <= 0.75)).toBe(true);
  const vibrations = harmonicFrequencies(raman.frames[0].hessian!).slice(6);
  expectClose(vibrations, raman.modes.map(mode => mode.frequencyCm1).sort((a, b) => a - b), 0.1);
  expectOrbitalTable(raman, 'cclib-firefly-dvb_raman.out');
  expectOrbitalValues(raman, 'cclib-firefly-dvb_raman.out');
  expectSchema(raman);
});

test('malformed GAMESS tables are refused rather than guessed', () => {
  const water = fixtureText('gamess/cclib-water_mp2.out'), ts = fixtureText('gamess/cclib-nh3_ts_ir.out');
  expectLineEndingsIgnored(water, parseGamessLog);
  const broken = [
    water.replace('    1  O  1  S    0.994203', '    1  O  1  S    0.99x203'),
    water.replace('    5  O  1  Z    0.000000', '    5  O  1  X    0.000000'),
    water.replace('    7  H  3  S   -0.005627', '    7  H  2  S   -0.005627'),
    ts.replace('X 0.756809 0.000000', 'X 0.75680 0.000000'),
    ts.replace('IR INTENSITY:     21.64357     0.00000', 'IR INTENSITY:     21.64357'),
  ];
  for (const variant of broken) expect(() => parseGamessLog(variant)).toThrow();
  expect(() => parseGamessLog(' GAMESS VERSION = 30 SEP 2018 (R3)\n')).toThrow(/geometry/);
});

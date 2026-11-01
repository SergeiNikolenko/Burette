import { expect, test } from 'bun:test';
import { parseGaussianLog } from '../apps/desktop/src/lib/molecular-workbench/quantum/gaussian-log';
import { evaluateOrbital } from '../apps/desktop/src/lib/molecular-workbench/gaussian';
import type { Vec3 } from '../apps/desktop/src/lib/molecular-workbench/types';
import { cclibReference, expectClose, expectLineEndingsIgnored, expectSchema, fixtureText } from './quantum-output-fixture';

const reference = cclibReference('gaussian');
type OrbitalReference = { pointsAngstrom: Vec3[]; spins: { orthonormalityError: number; orbitals: Record<string, number[]> }[] };
const orbitalReference: Record<string, OrbitalReference> = JSON.parse(fixtureText('gaussian/orbital-reference.json'));
const read = (name: string) => parseGaussianLog(fixtureText(`gaussian/${name}`));

test('pop=full with gfinput yields the printed basis and coefficients, matching PySCF orbital values', () => {
  for (const name of ['cclib-dvb_sp.out', 'cclib-C_bigbasis-trimmed.out']) {
    const document = read(name), expected = reference[name], values = orbitalReference[name];
    expect(document.basis!.length).toBeGreaterThan(0);
    expect(document.orbitals.map(orbital => orbital.coefficients.length)).toEqual(document.orbitals.map(() => expected.nbasis));
    expectClose(document.orbitals.map(orbital => orbital.energyHartree), expected.moenergies![0], 5e-6); // printed to 1e-5 Eh
    // Gaussian prints a label only where symmetry assigned one; cclib title-cases them.
    document.orbitals.forEach((orbital, i) => { if (orbital.symmetry) expect(orbital.symmetry).toBe(expected.mosyms![0][i]!.toUpperCase()); });
    expect(document.orbitals.filter(orbital => orbital.occupancy === 2)).toHaveLength(expected.homos![0] + 1);
    // Five-decimal coefficients are orthonormal in PySCF's AO overlap to print precision.
    expect(values.spins[0].orthonormalityError).toBeLessThan(5e-5);
    for (const [number, samples] of Object.entries(values.spins[0].orbitals)) {
      values.pointsAngstrom.forEach((point, p) => expect(Math.abs(evaluateOrbital(document, Number(number), point) - samples[p])).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(samples[p]))));
    }
    expectClose(document.frames[0].charges![0].values, expected.atomcharges!.mulliken, 1e-9);
    expectSchema(document);
  }
  // aug-cc-pVQZ in 5D/7F: pure d, f and g shells, read from D 0, D+1, D-1, ... labels.
  expect(read('cclib-C_bigbasis-trimmed.out').basis!.map(shell => shell.kind + (shell.spherical ? '*' : '')).join('')).toBe('sssssspppppd*d*d*d*f*f*f*g*g*');
});

test('without gfinput, eigenvalues give energies and occupations only; spin channels stay separate', () => {
  const radical = read('cclib-dvb_un_sp.log'), expected = reference['cclib-dvb_un_sp.log'];
  expect(radical.basis).toBeUndefined();
  expected.moenergies!.forEach((energies, s) => {
    const channel = radical.orbitals.filter(orbital => orbital.spin === (s ? 'beta' : 'alpha'));
    expectClose(channel.map(orbital => orbital.energyHartree), energies, 5e-6);
    expect(channel.filter(orbital => orbital.occupancy === 1)).toHaveLength(expected.homos![s] + 1);
    expect(channel.every(orbital => orbital.coefficients.length === 0)).toBe(true);
  });
  // `Mulliken charges and spin densities` keeps the charge column.
  expectClose(radical.frames[0].charges![0].values, expected.atomcharges!.mulliken, 1e-9);
  expectSchema(radical);
});

test('optimization properties and correlated energies belong to the geometry that printed them', () => {
  const opt = read('cclib-dvb_gopt.out'), expected = reference['cclib-dvb_gopt.out'];
  expectClose(opt.frames.slice(0, 5).map(frame => frame.energyHartree!), expected.scfenergies!, 1e-9);
  // Population analysis is printed for the first and the final (reprinted) geometry only.
  expect(opt.frames.map(frame => !!frame.charges)).toEqual([true, false, false, false, false, true]);
  expectClose(opt.frames.at(-1)!.charges![0].values, expected.atomcharges!.mulliken, 1e-9);
  expectClose(opt.frames.at(-1)!.dipoleDebye!, expected.dipole_debye!, 1e-9);
  expectClose(opt.orbitals.map(orbital => orbital.energyHartree), expected.moenergies![0], 5e-6);

  const mp2 = read('cclib-water_mp2.log'), correlated = reference['cclib-water_mp2.log'];
  expect(mp2.frames[0].energyHartree).toBe(correlated.mpenergies![0][0]);
  expectClose(mp2.frames[0].dipoleDebye!, correlated.dipole_debye!, 1e-9);
});

test('malformed orbital tables are refused rather than guessed', () => {
  const text = fixtureText('gaussian/cclib-dvb_sp.out');
  expectLineEndingsIgnored(text, parseGaussianLog);
  const broken = [
    text.replace('   1 1   C  1S          0.69930', '   1 1   C  1S          0.6x930'),
    text.replace('   3        2PX        -0.00005', '   3        2PY        -0.00005'),
    text.replace(' SP   3 1.00       0.000000000000\n      0.2941249355D+01 -0.9996722919D-01  0.1559162750D+00', ' SP   3 1.00       0.000000000000\n      0.2941249355D+01 -0.9996722919D-01'),
    text.replace('     1  C   -0.004504', '     1  H   -0.004504'),
  ];
  for (const variant of broken) expect(() => parseGaussianLog(variant)).toThrow();
});

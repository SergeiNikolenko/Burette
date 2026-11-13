import { expect, test } from 'bun:test';
import { parseGaussianLog } from '../apps/desktop/src/lib/molecular-workbench/quantum/gaussian-log';
import { parseScientificFile } from '../apps/desktop/src/lib/molecular-workbench/quantum';
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
  // The geometry reprinted after `Optimization completed.` is the last step, not a sixth frame.
  expectClose(opt.frames.map(frame => frame.energyHartree!), expected.scfenergies!, 1e-9);
  expect(opt.frames.at(-1)!.energyHartree).toBe(-382.308266602); // the last `SCF Done`
  // Population analysis is printed for the first and the final geometry only.
  expect(opt.frames.map(frame => !!frame.charges)).toEqual([true, false, false, false, true]);
  expectClose(opt.frames.at(-1)!.charges![0].values, expected.atomcharges!.mulliken, 1e-9);
  expectClose(opt.frames.at(-1)!.dipoleDebye!, expected.dipole_debye!, 1e-9);
  expectClose(opt.orbitals.map(orbital => orbital.energyHartree), expected.moenergies![0], 5e-6);

  const mp2 = read('cclib-water_mp2.log'), correlated = reference['cclib-water_mp2.log'];
  expect(mp2.frames[0].energyHartree).toBe(correlated.mpenergies![0][0]);
  expectClose(mp2.frames[0].dipoleDebye!, correlated.dipole_debye!, 1e-9);
});

test('a coefficient window (EOM-CCSD prints from MO 31) opens with energies and occupations of every orbital', () => {
  const eom = read('cclib-dvb_eomccsd.log');
  expect(eom.frames).toHaveLength(1);
  expect(eom.frames[0].energyHartree).toBe(-380.50037233); // CCSD `E(Corr)`, printed after `SCF Done`
  expect(eom.basis).toBeUndefined();
  expect(eom.orbitals).toHaveLength(60);
  expect(eom.orbitals.every(orbital => orbital.coefficients.length === 0)).toBe(true);
  expect(eom.orbitals.filter(orbital => orbital.occupancy === 2)).toHaveLength(35);
  expect([eom.orbitals[0].energyHartree, eom.orbitals[34].energyHartree, eom.orbitals[35].energyHartree]).toEqual([-11.04058, -0.22227, 0.19887]);
  expect(eom.frames[0].charges![0].values.slice(0, 2)).toEqual([0.001721, -0.060489]);
  expectSchema(eom);

  // With gfinput present, a print that skips the first orbitals still yields no coefficients.
  const full = fixtureText('gaussian/cclib-dvb_sp.out');
  const window = parseGaussianLog(full.replace(/(Molecular Orbital Coefficients:\n)[\s\S]*?\n(?= +6 +7 +8 +9 +10\n)/u, '$1'));
  expect(window.basis).toBeUndefined();
  expect(window.orbitals.map(orbital => [orbital.energyHartree, orbital.occupancy])).toEqual(read('cclib-dvb_sp.out').orbitals.map(orbital => [orbital.energyHartree, orbital.occupancy]));
  expect(window.orbitals.every(orbital => orbital.coefficients.length === 0)).toBe(true);
});

test('malformed orbital tables are refused rather than guessed', () => {
  const text = fixtureText('gaussian/cclib-dvb_sp.out');
  expectLineEndingsIgnored(text, parseGaussianLog);
  const broken = [
    text.replace('   1 1   C  1S          0.69930', '   1 1   C  1S          0.6x930'),
    text.replace('   3        2PX        -0.00005', '   3        2PY        -0.00005'),
    text.replace(' SP   3 1.00       0.000000000000\n      0.2941249355D+01 -0.9996722919D-01  0.1559162750D+00', ' SP   3 1.00       0.000000000000\n      0.2941249355D+01 -0.9996722919D-01'),
    text.replace('     1  C   -0.004504', '     1  H   -0.004504'),
    text.replace(/(Molecular Orbital Coefficients:\n) +1 +2 +3 +4 +5\n/u, '$1                           0         1         2         3         4\n'),
    text.replace(/(Molecular Orbital Coefficients:\n[\s\S]*?\n) +6 +7 +8 +9 +10\n/u, '$1                           7         8         9        10        11\n'),
  ];
  for (const variant of broken) expect(() => parseGaussianLog(variant)).toThrow();
});

test('GIAO shieldings, Mulliken spin densities, S**2 and forces belong to the geometry that printed them', () => {
  const nmr = parseScientificFile('cclib-dvb_nmr.log', fixtureText('gaussian/cclib-dvb_nmr.log')).frames[0].spectra!.spectra[0];
  if (nmr.kind !== 'nmr') throw new Error('expected shieldings');
  // `1  C    Isotropic =   114.0880   Anisotropy =   147.6438`
  expect([nmr.atomIndices.length, nmr.valuesPpm.slice(0, 3), nmr.auxiliary![0].values[0]]).toEqual([20, [114.088, 114.088, 117.763], 147.6438]);
  const open = read('cclib-dvb_un_sp.log').frames[0];
  expect(open.spinPopulations![0].values.slice(0, 2)).toEqual([0.213022, 0.02541]);
  expect(open.spinSquared).toBe(0.7778); // `S**2 before annihilation     0.7778,   after     0.7504`
  const forces = read('cclib-dvb_gopt.out').frames.map(frame => frame.forcesKcalMolAngstrom![0][0]);
  // `1  6  -0.050454775  0.000000000  0.000584594` Hartree/bohr at the first step.
  expect(forces[0]).toBeCloseTo(-0.050454775 * 627.5094740631 / 0.529177210903, 10);
  expect(forces).toHaveLength(5);
});

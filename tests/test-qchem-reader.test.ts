import { expect, test } from 'bun:test';
import { QCHEM_SIGNATURE } from '../apps/desktop/src/lib/molecular-workbench/quantum/signatures';
import { parseQchemLog } from '../apps/desktop/src/lib/molecular-workbench/quantum/qchem-log';
import { cclibReference, expectClose, expectGeometries, expectLineEndingsIgnored, expectSchema, expectTruncationsKeepHistory, fixtureText } from './quantum-output-fixture';

const reference = cclibReference('qchem');
const read = (name: string) => parseQchemLog(fixtureText(`qchem/${name}`));

test('Q-Chem 5.4 single points match cclib: orbitals, spin channels, charge models and dipoles', () => {
  for (const name of ['cclib-dvb_sp.out', 'cclib-dvb_sp_un.out', 'cclib-water_mp2.out', 'cclib-water_ccsd_t.out']) {
    const text = fixtureText(`qchem/${name}`), expected = reference[name];
    expect(QCHEM_SIGNATURE.test(text.slice(0, 64 * 1024))).toBe(true);
    const document = parseQchemLog(text);
    expectGeometries(document, expected, 1e-10);
    expected.moenergies!.forEach((energies, s) => {
      const channel = document.orbitals.filter(orbital => orbital.spin === (s ? 'beta' : 'alpha'));
      expectClose(channel.map(orbital => orbital.energyHartree), energies, 5e-4); // printed to 0.001 Eh
      expect(channel.filter(orbital => orbital.occupancy > 0)).toHaveLength(expected.homos![s] + 1);
      expect(channel.map(orbital => orbital.symmetry)).toEqual(expected.mosyms![s]);
      expect(channel.every(orbital => orbital.coefficients.length === 0)).toBe(true);
    });
    expect(document.orbitals.every(orbital => orbital.occupancy === (expected.mult === 1 ? 2 : 1) || orbital.occupancy === 0)).toBe(true);
    const charges = document.frames[0].charges!;
    for (const [model, values] of Object.entries(expected.atomcharges!)) {
      // cclib keeps the second table Q-Chem 5.4 prints under the ChElPG heading (values beyond ±20 e);
      // the first table is the fitted charge set. RESP is not a Burette charge model.
      if (model === 'chelpg' || model === 'resp') continue;
      expectClose(charges.find(set => set.model === model)!.values, values, 1e-9);
    }
    const chelpg = charges.find(set => set.model === 'chelpg');
    if (chelpg) {
      expect(chelpg.values.every(value => Math.abs(value) < 1)).toBe(true);
      expect(Math.abs(chelpg.values.reduce((sum, value) => sum + value, 0) - expected.charge!)).toBeLessThan(1e-5);
    }
    expectClose(document.frames[0].dipoleDebye!, expected.dipole_debye!, 1e-9);
    expectSchema(document);
  }
  expect(read('cclib-dvb_sp.out').frames[0].charges!.find(set => set.model === 'chelpg')!.values.slice(0, 3)).toEqual([0.174381, -0.195923, -0.115074]);
  expect(read('cclib-water_mp2.out').frames[0].energyHartree).toBe(reference['cclib-water_mp2.out'].mpenergies![0][0]);
  expect(read('cclib-water_ccsd_t.out').frames[0].energyHartree).toBe(reference['cclib-water_ccsd_t.out'].ccenergies![0]);
});

test('optimization keeps every cycle, its convergence and the final orbitals', () => {
  const name = 'cclib-dvb_gopt.out', text = fixtureText(`qchem/${name}`), document = parseQchemLog(text), expected = reference[name];
  expectGeometries(document, expected, 1e-10);
  expectClose(document.frames.map(frame => frame.energyHartree!), expected.scfenergies!, 1e-10);
  expect(document.converged).toBe(expected.optdone);
  expectClose(document.orbitals.map(orbital => orbital.energyHartree), expected.moenergies![0], 5e-4);
  expectClose(document.frames.at(-1)!.charges![0].values, expected.atomcharges!.mulliken, 1e-9);
  expect(expectTruncationsKeepHistory(text, parseQchemLog)).toBe(5);
  expect(parseQchemLog(text.slice(0, text.indexOf('OPTIMIZATION CONVERGED'))).converged).toBeUndefined();
});

test('IR and Raman analyses keep signed imaginary modes, intensities and only defined depolarizations', () => {
  for (const name of ['cclib-dvb_ir.out', 'cclib-dvb_raman.out']) {
    const document = read(name), expected = reference[name];
    expectGeometries(document, expected, 1e-10);
    // A numerical Raman job's displaced SCFs are not the reference energy.
    expect(document.frames[0].energyHartree).toBeCloseTo(expected.scfenergies![0], 9);
    expectClose(document.modes.map(mode => mode.frequencyCm1), expected.vibfreqs!, 1e-9);
    expectClose(document.modes.map(mode => mode.intensityKmMol!), expected.vibirs!, 1e-9);
    document.modes.forEach((mode, m) => expectClose(mode.displacements!.flat(), expected.vibdisps![m].flat(), 1e-12));
    expect(document.modes.map(mode => mode.index)).toEqual([...Array(54).keys()]);
    if (expected.vibramans) expectClose(document.modes.map(mode => mode.ramanActivityAngstrom4Amu!), expected.vibramans, 1e-9);
    expectSchema(document);
  }
  const raman = read('cclib-dvb_raman.out');
  expect(raman.modes.slice(0, 2).map(mode => mode.frequencyCm1)).toEqual([-106.88, -102.92]);
  // Raman-inactive modes print a 0.000 depolarization that is not a measured ratio.
  expect(raman.modes[1]).not.toHaveProperty('ramanDepolarizationRatio');
  expect(raman.modes[0].ramanDepolarizationRatio).toBe(0.75);
});

test('malformed Q-Chem tables are refused rather than guessed', () => {
  const text = fixtureText('qchem/cclib-dvb_ir.out');
  expectLineEndingsIgnored(text, parseQchemLog);
  const broken = [
    text.replace('    1      C       ', '    2      C       '),
    text.replace(' Frequency:        47.24 ', ' Frequency:        4x.24 '),
    text.replace(/( C {9}-0\.000 -0\.000 -0\.079)/u, ' H         -0.000 -0.000 -0.079'),
    text.replace('      1 C                    -0.004404', '      1 C                    -0.004404   7   8'),
  ];
  for (const variant of broken) expect(() => parseQchemLog(variant)).toThrow();
  expect(() => parseQchemLog('                  Welcome to Q-Chem\n')).toThrow(/geometry/);
});

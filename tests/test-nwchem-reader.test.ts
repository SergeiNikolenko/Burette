import { expect, test } from 'bun:test';
import { NWCHEM_SIGNATURE } from '../apps/desktop/src/lib/molecular-workbench/quantum/signatures';
import { parseNwchemLog } from '../apps/desktop/src/lib/molecular-workbench/quantum/nwchem-log';
import { cclibReference, expectClose, expectGeometries, expectLineEndingsIgnored, expectSchema, expectTruncationsKeepHistory, fixtureText } from './quantum-output-fixture';

const reference = cclibReference('nwchem');
const read = (name: string) => parseNwchemLog(fixtureText(`nwchem/${name}`));

test('NWChem 7.3 optimization and frequencies match cclib frame by frame', () => {
  const text = fixtureText('nwchem/water-opt-freq.out');
  expect(NWCHEM_SIGNATURE.test(text)).toBe(true);
  const document = parseNwchemLog(text), expected = reference['water-opt-freq.out'];
  expectGeometries(document, expected);
  // cclib lists one SCF energy per accepted step; line-search trials and the repeated
  // frequency-job SCF of the final geometry are not separate frames.
  expectClose(document.frames.slice(0, 3).map(frame => frame.energyHartree!), expected.scfenergies!.slice(0, 3), 1e-12);
  expect(Math.abs(document.frames[3].energyHartree! - expected.scfenergies![3])).toBeLessThan(1e-10);
  expect(document.converged).toBe(expected.optdone);
  expect(document.frames.slice(0, 3).every(frame => frame.modes === undefined && frame.hessian === undefined)).toBe(true);
  expectClose(document.modes.map(mode => mode.frequencyCm1), expected.vibfreqs!, 5e-4);
  expectClose(document.modes.map(mode => mode.intensityKmMol!), expected.vibirs!, 5e-4);
  expect(document.modes.map(mode => mode.index)).toEqual([...Array(9).keys()]);
  document.modes.forEach((mode, m) => expectClose(mode.displacements!.flat(), expected.vibdisps![m].flat(), 1e-5));
  expectClose(document.frames[3].charges!.find(set => set.model === 'mulliken')!.values, expected.atomcharges!.mulliken, 1e-9);
  // NWChem prints the Hessian mass-weighted in Hartree/bohr²/kamu; Burette keeps Hartree/bohr².
  const hessian = document.frames[3].hessian!, masses = hessian.massesAmu!;
  expect(masses).toEqual([15.99491, 1.007825, 1.007825]);
  for (let row = 0; row < 9; row++) for (let column = 0; column < 9; column++) {
    const weighted = hessian.values[row * 9 + column] / Math.sqrt(masses[Math.floor(row / 3)] * masses[Math.floor(column / 3)]) * 1000;
    expect(Math.abs(weighted - expected.hessian![Math.max(row, column)][Math.min(row, column)])).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(weighted)));
  }
  const alpha = document.orbitals.filter(orbital => orbital.spin === 'alpha');
  expect(alpha).toHaveLength(15);
  expect(alpha.filter(orbital => orbital.occupancy === 2)).toHaveLength(expected.homos![0] + 1);
  expected.moenergies![0].forEach((energy, i) => { if (Number.isFinite(energy)) expect(Math.abs(alpha[i].energyHartree - energy)).toBeLessThan(1e-6); });
  expect(alpha.every(orbital => orbital.coefficients.length === 0)).toBe(true);
  expectSchema(document);
});

test('UHF and DFT outputs keep both spin channels, signed imaginary modes and the Hessian', () => {
  const radical = read('oh-uhf.out'), expected = reference['oh-uhf.out'];
  expectGeometries(radical, expected);
  for (const [s, spin] of (['alpha', 'beta'] as const).entries()) {
    const channel = radical.orbitals.filter(orbital => orbital.spin === spin);
    expect(channel).toHaveLength(expected.nmo!);
    expect(channel.filter(orbital => orbital.occupancy === 1)).toHaveLength(expected.homos![s] + 1);
    expected.moenergies![s].forEach((energy, i) => { if (Number.isFinite(energy)) expect(Math.abs(channel[i].energyHartree - energy)).toBeLessThan(1e-6); });
    expect(channel.every(orbital => orbital.occupancy <= 1)).toBe(true);
  }
  expectClose(radical.frames[0].charges![0].values, expected.atomcharges!.mulliken, 1e-9);
  expectSchema(radical);

  const methanol = read('methanol-dft-freq.out'), dft = reference['methanol-dft-freq.out'];
  expectGeometries(methanol, dft);
  expectClose([methanol.frames[0].energyHartree!], dft.scfenergies!, 1e-12);
  expectClose(methanol.modes.map(mode => mode.frequencyCm1), dft.vibfreqs!, 5e-4);
  expect(methanol.modes[0].frequencyCm1).toBeLessThan(-299);
  expectClose(methanol.modes.map(mode => mode.intensityKmMol!), dft.vibirs!, 5e-4);
  const occupied = methanol.orbitals.filter(orbital => orbital.occupancy === 2);
  expect(occupied).toHaveLength(dft.homos![0] + 1);
  expectClose(methanol.orbitals.map(orbital => orbital.energyHartree), dft.moenergies![0], 1e-6);
  const hessian = methanol.frames[0].hessian!;
  expect(hessian.dimension).toBe(18);
  expect(Math.abs(hessian.values[0] / hessian.massesAmu![0] * 1000 - dft.hessian![0][0])).toBeLessThan(1e-9);
  expectSchema(methanol);
});

test('correlated energies supersede the SCF energy of their own geometry', () => {
  const document = read('cclib-water-mp2.out'), expected = reference['cclib-water-mp2.out'];
  expectGeometries(document, expected);
  expect(document.frames[0].energyHartree).toBeCloseTo(expected.mpenergies![0].at(-1)!, 9);
  expect(document.frames[0].energyHartree).not.toBeCloseTo(expected.scfenergies![0], 3);
  expectClose(document.frames[0].charges![0].values, expected.atomcharges!.mulliken, 1e-9);
});

test('failed and interrupted runs stay truthful', () => {
  const failed = read('water-scf-fail.out');
  expect(failed.converged).toBe(false);
  expect(failed.frames).toHaveLength(1);
  const text = fixtureText('nwchem/water-opt-freq.out');
  expect(expectTruncationsKeepHistory(text, parseNwchemLog)).toBe(4);
  // Cut inside the final normal-mode table: the geometry history survives, the partial analysis does not.
  const cut = text.slice(0, text.lastIndexOf('P.Frequency     1826.58'));
  const partial = parseNwchemLog(cut);
  expect(partial.frames).toHaveLength(4);
  expect(partial.modes.length === 0 || partial.modes.every(mode => mode.displacements?.length === 3)).toBe(true);
  expect(parseNwchemLog(text.slice(0, text.indexOf('Optimization converged'))).converged).toBeUndefined();
});

test('malformed NWChem tables are refused rather than guessed', () => {
  const text = fixtureText('nwchem/water-opt-freq.out');
  expectLineEndingsIgnored(text, parseNwchemLog);
  const broken = [
    text.replace('0.12000000\n', 'NaN\n'),
    text.replace('    2 H                    1.0000    -0.79000000', '    2 C                    6.0000    -0.79000000').replace(/(\n {4}2 H {20}1\.0000 {5}-0\.7)/, '$1'),
    text.replace(/( {4}3 H {20}1\.0000 {5}0\.7[^\n]*\n)/, '$1    4 H                    1.0000     0.00000000     0.00000000     0.00000000\n'),
    text.slice(0, text.lastIndexOf('58.109')) + '-58.109' + text.slice(text.lastIndexOf('58.109') + 6),
    text.replace('    1    -0.16666     0.00000     0.16660', '    1    -0.16666     0.00000'),
  ];
  for (const variant of broken) expect(() => parseNwchemLog(variant)).toThrow();
  expect(() => parseNwchemLog('NWChem Input Module\n')).toThrow(/geometry/);
});

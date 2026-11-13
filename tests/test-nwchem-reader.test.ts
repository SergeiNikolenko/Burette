import { expect, test } from 'bun:test';
import { NWCHEM_SIGNATURE } from '../apps/desktop/src/lib/molecular-workbench/quantum/signatures';
import { parseNwchemLog } from '../apps/desktop/src/lib/molecular-workbench/quantum/nwchem-log';
import { cclibReference, expectClose, expectGeometries, expectLineEndingsIgnored, expectSchema, expectTruncationsKeepHistory, fixtureText, harmonicFrequencies } from './quantum-output-fixture';

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

// NWChem 6.0 QA output QA/tests/hess_h2o/hess_h2o.out (ECL-2.0, SHA-256
// 01a6cfd263a0d1530b87fba6bd22d01abf06be468d8c9d7d96754aaeada4d061), lines 3002–3018 and 4221–4247:
// https://github.com/nwchemgit/nwchem/blob/8701f25ad941a4237cdd5a843b6d569f5b3fff1d/QA/tests/hess_h2o/hess_h2o.out
// The last `task scf freq` reweights the Hessian with the isotopes `mass 2 2.014101779 ; mass 3 3.01604927`.
const HESS_H2O = `
                         Geometry "geometry" -> "geometry"
                         ---------------------------------

 Output coordinates in a.u. (scale by  1.000000000 to convert to a.u.)

  No.       Tag          Charge          X              Y              Z
 ---- ---------------- ---------- -------------- -------------- --------------
    1 O                    8.0000     0.00000000     0.00000000     0.28432369
    2 H                    1.0000    -1.43256442     0.00000000    -0.91716871
    3 H                    1.0000     1.43256442     0.00000000    -0.91716871

      Atomic Mass 
      ----------- 

      O                 15.994910
      H                  1.007825

 ---------------------------- Atom information ----------------------------
     atom    #        X              Y              Z            mass
 --------------------------------------------------------------------------
    O        1  0.0000000D+00  0.0000000D+00  2.8432369D-01  1.5994910D+01
    H        2 -1.4325644D+00  0.0000000D+00 -9.1716871D-01  2.0141018D+00
    H        3  1.4325644D+00  0.0000000D+00 -9.1716871D-01  3.0160493D+00
 --------------------------------------------------------------------------




          ----------------------------------------------------
          MASS-WEIGHTED NUCLEAR HESSIAN (Hartree/Bohr/Bohr/Kamu)
          ----------------------------------------------------


              1           2           3           4           5           6           7           8           9
   ----- ----- ----- ----- -----
    1   5.02629D+01
    2  -1.97223D-16-3.58723D-07
    3   9.59055D-15 5.94164D-15 3.96939D+01
    4  -7.08219D+01 1.35178D-15-3.81109D+01 2.17919D+02
    5  -2.03368D-15 5.03601D-07-3.82677D-15 6.44472D-16-2.57577D-05
    6  -5.93984D+01-8.33793D-15-5.59299D+01 1.37394D+02-9.02283D-16 1.49001D+02
    7  -5.78748D+01-1.02982D-15 3.11437D+01-1.49863D+01 5.28095D-15 2.45113D+01 1.45525D+02
    8   2.11608D-15 4.11536D-07-2.93873D-15-1.16640D-15 1.98891D-05 1.78301D-15-3.91991D-15-1.72008D-05
    9   4.85396D+01-6.86924D-15-4.57052D+01-2.45113D+01-1.27346D-15 7.03810D+00-9.17507D+01 1.68597D-14 9.95022D+01
`;

test('NWChem 6.0 fixed-width Hessian fields that touch are read with the isotopes of the analysis', () => {
  expect(HESS_H2O).toContain('    2  -1.97223D-16-3.58723D-07\n');
  const hessian = parseNwchemLog(HESS_H2O).frames[0].hessian!;
  expect(hessian.massesAmu).toEqual([15.99491, 2.0141018, 3.0160493]);
  // Row 2, column 2 (mass-weighted, Hartree/bohr²/kamu) back from Hartree/bohr².
  expect(hessian.values[1 * 9 + 1] / 15.99491 * 1000).toBeCloseTo(-3.58723e-7, 18);
  // The same task's printed frequencies (lines 4269 and 4282 of the output).
  expectClose(harmonicFrequencies(hessian).slice(6), [1463.33, 2579.31, 3123.05], 0.05);
});

test('NWChem optimizations bind the final orbitals and charges, printed by the line search, to the accepted geometry', () => {
  // cclib data/NWChem/basicNWChem7.0: the line search computes the next step's geometry, and that
  // step's own SCF only prints `The SCF is already converged` with the same energy.
  const hf = read('cclib-dvb_gopt_hf.out');
  expect(hf.frames).toHaveLength(5);
  expect(hf.converged).toBe(true);
  expect(hf.frames.at(-1)!.energyHartree).toBe(-379.777955110136);
  expect(hf.frames.every(frame => frame.charges?.[0].model === 'mulliken')).toBe(true);
  // Printed after `Total SCF energy =   -379.777955110136` (line 4875), before the geometry of step 4.
  expect(hf.frames.at(-1)!.charges![0].values.map(value => Math.round(value * 100) / 100)).toEqual([0, 0, -0.06, -0.06, -0.06, -0.06, 0.06, 0.06, 0.06, 0.06, -0.06, -0.06, 0.06, 0.06, -0.13, -0.13, 0.06, 0.06, 0.06, 0.06]);
  expect(hf.frames.at(-1)!.dipoleDebye!.map(Math.abs)).toEqual([0, 0, 0]);
  expect(hf.orbitals).toHaveLength(45);
  expect(hf.orbitals[0].energyHartree).toBe(-11.0409);
  expect(hf.orbitals.filter(orbital => orbital.occupancy === 2)).toHaveLength(35);
  expectSchema(hf);

  const ks = read('cclib-dvb_gopt_ks.out');
  expect(ks.frames).toHaveLength(4);
  expect(ks.frames.at(-1)!.energyHartree).toBe(-382.308261640255);
  expect(ks.orbitals).toHaveLength(60);
  // Vector 60 of the final line search (line 5202); the previous step printed 7.946114D-01.
  expect(ks.orbitals.at(-1)!.energyHartree).toBe(0.7945871);
  expect(ks.orbitals[0].energyHartree).toBe(-10.02022);
  expectSchema(ks);
});

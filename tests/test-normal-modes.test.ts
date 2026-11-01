import { expect, test } from 'bun:test';
import { harmonicModes, symmetricEigen } from '../apps/desktop/src/lib/molecular-workbench/normal-modes';
import { hessianFromSquare } from '../apps/desktop/src/lib/molecular-workbench/hessian';
import { parseScientificFile } from '../apps/desktop/src/lib/molecular-workbench/quantum';
import type { VibrationalMode } from '../apps/desktop/src/lib/molecular-workbench/scientific-types';
import { cclibReference, expectClose, fixtureText } from './quantum-output-fixture';

const read = (path: string) => parseScientificFile(path.split('/').at(-1)!, fixtureText(path));
/** Unit vectors agree up to their sign. */
function expectSameDirection(actual: VibrationalMode, expected: number[], tolerance: number) {
  const flat = actual.displacements!.flat(), norm = Math.hypot(...expected);
  const sign = Math.sign(flat.reduce((sum, value, i) => sum + value * expected[i], 0));
  expectClose(flat.map(value => value * sign), expected.map(value => value / norm), tolerance);
}

test('symmetric eigenpairs reproduce the matrix', () => {
  const n = 7, matrix = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) matrix[i * n + j] = matrix[j * n + i] = Math.sin(i * 3 + j * 7 + 1) + (i === j ? i : 0);
  const { values, vectors } = symmetricEigen(matrix, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let rebuilt = 0, identity = 0;
    for (let k = 0; k < n; k++) { rebuilt += vectors[i * n + k] * values[k] * vectors[j * n + k]; identity += vectors[k * n + i] * vectors[k * n + j]; }
    expect(Math.abs(rebuilt - matrix[i * n + j])).toBeLessThan(1e-12);
    expect(Math.abs(identity - (i === j ? 1 : 0))).toBeLessThan(1e-12);
  }
  expect([...values].every((value, i) => i === 0 || value >= values[i - 1])).toBe(true);
});

test('a Gaussian 16 Hessian gives the frequencies, reduced masses, force constants and modes Gaussian stored', () => {
  const water = read('gaussian16-water-raman.fchk');
  const modes = harmonicModes(water.atoms, water.frames[0].hessian!);
  expect(modes).toHaveLength(3);
  modes.forEach((mode, m) => {
    const stored = water.modes[m];
    expect(Math.abs(mode.frequencyCm1 - stored.frequencyCm1)).toBeLessThan(0.02);
    expect(Math.abs(mode.reducedMassAmu! - stored.reducedMassAmu!)).toBeLessThan(1e-5);
    expect(Math.abs(mode.forceConstantMdynAngstrom! / stored.forceConstantMdynAngstrom! - 1)).toBeLessThan(2e-5);
    expectSameDirection(mode, stored.displacements!.flat(), 1e-6);
  });
});

test('projection matches PySCF off a stationary point and ORCA, GAMESS and a linear molecule at theirs', () => {
  // PySCF's harmonic analysis of its own RHF Hessian, with the same masses (water away from its minimum).
  const qcschema = read('qcschema/water-hf-hessian.json'), pyscf = JSON.parse(fixtureText('qcschema/hessian-reference.json'))['water-hf-hessian.json'];
  const own = hessianFromSquare(pyscf.hessian, 3, 'qcschema', qcschema.frames[0].hessian!.massesAmu);
  expectClose(harmonicModes(qcschema.atoms, own).map(mode => mode.frequencyCm1), pyscf.frequenciesCm1, 1e-3);
  // Psi4's density-fitted Hessian of the same geometry.
  expectClose(harmonicModes(qcschema.atoms, qcschema.frames[0].hessian!).map(mode => mode.frequencyCm1), pyscf.frequenciesCm1, 1);

  // ORCA's unit conversion differs from CODATA 2018 by about 2e-5 of the frequency.
  const relative = (actual: VibrationalMode[], expected: VibrationalMode[]) => expectClose(actual.map((mode, m) => mode.frequencyCm1 / expected[m].frequencyCm1), actual.map(() => 1), 3e-5);
  const methane = read('orca-3.0.2-methane.hess');
  relative(harmonicModes(methane.atoms, methane.frames[0].hessian!), methane.modes.slice(6));

  // GAMESS's transition state: one imaginary mode, the rest as GAMESS prints them.
  const ts = read('gamess/cclib-nh3_ts_ir.out'), printed = cclibReference('gamess')['cclib-nh3_ts_ir.out'].vibfreqs!;
  const computed = harmonicModes(ts.atoms, ts.frames.at(-1)!.hessian!);
  expect(computed[0].frequencyCm1).toBeLessThan(0);
  expectClose(computed.map(mode => mode.frequencyCm1), printed, 0.5);

  // CO2 keeps 3N − 5 = 4 modes. ORCA 5's six-column IR rows carry km/mol, as its output prints them.
  const co2 = read('orca-property/pyepfd-co2-opt-freq.hess');
  expectClose(co2.modes.slice(5).map(mode => mode.intensityKmMol!), cclibReference('orca-property')['pyepfd-co2-opt-freq.out'].vibirs!, 0.005);
  const linear = harmonicModes(co2.atoms, co2.frames[0].hessian!);
  relative(linear, co2.modes.slice(5));
  expectSameDirection(linear[3], co2.modes[8].displacements!.flat(), 1e-4);
});

test('a Hessian without masses or of other atoms is refused', () => {
  const water = read('gaussian16-water-raman.fchk'), hessian = water.frames[0].hessian!;
  expect(() => harmonicModes(water.atoms, { ...hessian, massesAmu: undefined })).toThrow('masses');
  expect(() => harmonicModes(water.atoms.slice(0, 2), hessian)).toThrow();
});

test('the quantum worker diagonalizes off the main thread and can be cancelled', async () => {
  const { computeHarmonicModes } = await import('../apps/desktop/src/lib/molecular-workbench/quantum-client');
  const water = read('gaussian16-water-raman.fchk'), hessian = water.frames[0].hessian!;
  expect(await computeHarmonicModes(water.atoms, hessian)).toEqual(harmonicModes(water.atoms, hessian));
  await expect(computeHarmonicModes(water.atoms, { ...hessian, massesAmu: undefined })).rejects.toThrow('masses');
  const controller = new AbortController();
  const pending = computeHarmonicModes(water.atoms, hessian, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});

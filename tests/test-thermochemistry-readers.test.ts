import { expect, test } from 'bun:test';
import { parseScientificFile } from '../apps/desktop/src/lib/molecular-workbench/quantum';
import type { Thermochemistry } from '../apps/desktop/src/lib/molecular-workbench/scientific-types';
import { expectClose, expectSchema, fixtureText } from './quantum-output-fixture';

const KCAL = 627.5094740631;
const read = (path: string) => {
  const document = parseScientificFile(path, fixtureText(path));
  expectSchema(document);
  return document;
};
// Each program's printed numbers. G is H − T·S where none is printed (NWChem, Q-Chem); an entropy printed
// as T·S in Hartree (ORCA, xTB) is converted to cal/(mol·K); corrections add to the frame's energy.
const printed: Record<string, (energy: number) => Required<Thermochemistry>> = {
  'gaussian/cclib-dvb_ir.out': () => ({ temperatureKelvin: 298.15, zeroPointHartree: 0.177132, enthalpyHartree: -382.121307, gibbsHartree: -382.164915, entropyCalMolKelvin: 91.781 }),
  'orca-log/cclib-orca5-dvb_ir.out': () => ({ temperatureKelvin: 298.15, zeroPointHartree: 0.17701962, enthalpyHartree: -381.86823907, gibbsHartree: -381.91112705, entropyCalMolKelvin: 0.04288798 * KCAL * 1000 / 298.15 }),
  'orca-log/cclib-orca6-dvb_ir.out': () => ({ temperatureKelvin: 298.15, zeroPointHartree: 0.17701463, enthalpyHartree: -381.86823509, gibbsHartree: -381.91114546, entropyCalMolKelvin: 0.04291036 * KCAL * 1000 / 298.15 }),
  'orca-property/pyepfd-co2-opt-freq_property.txt': () => ({ temperatureKelvin: 298.15, zeroPointHartree: 0.0116911597, enthalpyHartree: -188.5721027736, gibbsHartree: -188.5963513622, entropyCalMolKelvin: 0.0242485886 * KCAL * 1000 / 298.15 }),
  'orca-property/maa-apa-freq.property.txt': () => ({ temperatureKelvin: 298.15, zeroPointHartree: 0.12074338156179523, enthalpyHartree: -303.6980790192008, gibbsHartree: -303.73313298089414, entropyCalMolKelvin: 0.035053961693336154 * KCAL * 1000 / 298.15 }),
  'psi4/water-opt-freq.out': () => ({ temperatureKelvin: 298.15, zeroPointHartree: 0.02297870, enthalpyHartree: -75.98396398, gibbsHartree: -76.00533862, entropyCalMolKelvin: 44.987 }),
  'nwchem/water-opt-freq.out': energy => ({ temperatureKelvin: 298.15, zeroPointHartree: 0.022965, enthalpyHartree: energy + 0.026741, gibbsHartree: energy + 0.026741 - 298.15 * 44.967 / 1000 / KCAL, entropyCalMolKelvin: 44.967 }),
  'qchem/cclib-dvb_ir.out': energy => ({ temperatureKelvin: 298.15, zeroPointHartree: 111.254 / KCAL, enthalpyHartree: energy + 117.424 / KCAL, gibbsHartree: energy + 117.424 / KCAL - 298.15 * 92.038 / 1000 / KCAL, entropyCalMolKelvin: 92.038 }),
  'xtb/water-ohess.out': () => ({ temperatureKelvin: 298.15, zeroPointHartree: 0.020131359804, enthalpyHartree: -5.046632017985, gibbsHartree: -5.068030620232, entropyCalMolKelvin: 0.213986e-1 * KCAL * 1000 / 298.15 }),
};

test('every reader keeps the thermochemistry its program printed on the frequency geometry', () => {
  for (const [path, expected] of Object.entries(printed)) {
    const document = read(path);
    const frame = document.frames[document.referenceFrameIndex!];
    const values = expected(frame.energyHartree!);
    const keys = Object.keys(values) as (keyof Thermochemistry)[];
    expect(Object.keys(frame.thermochemistry ?? {}).sort(), path).toEqual([...keys].sort());
    expectClose(keys.map(key => frame.thermochemistry![key]!), keys.map(key => values[key]), 5e-6);
    // Earlier optimization steps had no frequency job.
    expect(document.frames.slice(0, document.referenceFrameIndex).some(item => item.thermochemistry), path).toBe(false);
  }
});

test('ORCA text outputs keep Mulliken and Löwdin charges and the total dipole of their geometry', () => {
  for (const version of ['5', '6']) {
    const frame = read(`orca-log/cclib-orca${version}-dvb_ir.out`).frames.at(-1)!;
    expect(frame.charges!.map(set => set.model)).toEqual(['mulliken', 'lowdin']);
    if (version === '6') expect(frame.charges!.map(set => set.values.slice(0, 3))).toEqual([[-0.004143, -0.004143, -0.07658], [0.003937, 0.003937, -0.043833]]);
    for (const set of frame.charges!) expect(Math.abs(set.values.reduce((sum, value) => sum + value, 0))).toBeLessThan(1e-5);
    expect(frame.dipoleDebye!.map(Math.abs)).toEqual([0, 0, 0]);
  }
});

test('a Gaussian freq=hpmodes log reads its standard mode table and skips the high-precision copy', () => {
  const document = read('gaussian/cclib-dvb_ir.out');
  expect(document.modes).toHaveLength(54);
  expect(document.modes[0].frequencyCm1).toBeCloseTo(53.1981, 3);
  expect(document.modes.every(mode => mode.displacements?.length === 20)).toBe(true);
});

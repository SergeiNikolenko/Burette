import type { ScientificFrame, Thermochemistry } from '../scientific-types';
import { numeric } from './reader-values';

const HARTREE_KCAL_MOL = 627.5094740631;

/** What a program prints; corrections and T·S become absolute values and an entropy below. */
export type Printed = 'temperature' | 'zeroPoint' | 'enthalpy' | 'gibbs' | 'entropy' | 'enthalpyCorrection' | 'entropyTerm';
/** One printed line. `kcal` marks values in kcal/mol; `header` must match the line two above. */
interface Rule { pattern: RegExp; fields: Printed[]; kcal?: boolean; header?: RegExp }
export type ThermochemistryProgram = 'gaussian' | 'orca' | 'psi4' | 'nwchem' | 'qchem' | 'xtb';

const RULES: Record<ThermochemistryProgram, Rule[]> = {
  // https://gaussian.com/thermo/
  gaussian: [
    { pattern: /^\s*Temperature\s+(\S+)\s+Kelvin\.\s+Pressure/u, fields: ['temperature'] },
    { pattern: /^\s*Zero-point correction=\s*(\S+)/u, fields: ['zeroPoint'] },
    { pattern: /^\s*Sum of electronic and thermal Enthalpies=\s*(\S+)\s*$/u, fields: ['enthalpy'] },
    { pattern: /^\s*Sum of electronic and thermal Free Energies=\s*(\S+)\s*$/u, fields: ['gibbs'] },
    { pattern: /^\s*Total\s+\S+\s+\S+\s+(\S+)\s*$/u, fields: ['entropy'], header: /^\s*E \(Thermal\)\s+CV\s+S\s*$/u },
  ],
  orca: [
    { pattern: /^\s*Temperature\s+\.\.\.\s+(\S+) K\s*$/u, fields: ['temperature'] },
    { pattern: /^\s*Zero point energy\s+\.\.\.\s+(\S+) Eh/u, fields: ['zeroPoint'] },
    { pattern: /^\s*Total Enthalpy\s+\.\.\.\s+(\S+) Eh/u, fields: ['enthalpy'] },
    { pattern: /^\s*Final entropy term\s+\.\.\.\s+(\S+) Eh/u, fields: ['entropyTerm'] },
    { pattern: /^\s*Final Gibbs free energy\s+\.\.\.\s+(\S+) Eh/u, fields: ['gibbs'] },
  ],
  psi4: [
    { pattern: /^\s*Correction ZPVE(?: to E_e)?\s+\S+ \[kcal\/mol\]\s+\S+ \[kJ\/mol\]\s+(\S+) \[Eh\]/u, fields: ['zeroPoint'] },
    { pattern: /^\s*Total S\s+(\S+) \[cal\/\(mol K\)\]/u, fields: ['entropy'] },
    { pattern: /^\s*Total H, Enthalpy at\s+(\S+) \[K\]\s+(\S+) \[Eh\]\s*$/u, fields: ['temperature', 'enthalpy'] },
    { pattern: /^\s*Total G, (?:Gibbs energy|Free enthalpy) at\s+(\S+) \[K\]\s+(\S+) \[Eh\]\s*$/u, fields: ['temperature', 'gibbs'] },
  ],
  nwchem: [
    { pattern: /^\s*Temperature\s+=\s+(\S+?)K\s*$/u, fields: ['temperature'] },
    { pattern: /^\s*Zero-Point correction to Energy\s+=\s+\S+ kcal\/mol\s+\(\s*(\S+) au\)/u, fields: ['zeroPoint'] },
    { pattern: /^\s*Thermal correction to Enthalpy\s+=\s+\S+ kcal\/mol\s+\(\s*(\S+) au\)/u, fields: ['enthalpyCorrection'] },
    { pattern: /^\s*Total Entropy\s+=\s+(\S+) cal\/mol-K/u, fields: ['entropy'] },
  ],
  qchem: [
    { pattern: /STANDARD THERMODYNAMIC QUANTITIES AT\s+(\S+) K/u, fields: ['temperature'] },
    { pattern: /^\s*Zero point vibrational energy:\s+(\S+) kcal\/mol\s*$/u, fields: ['zeroPoint'], kcal: true },
    { pattern: /^\s*Total Enthalpy:\s+(\S+) kcal\/mol\s*$/u, fields: ['enthalpyCorrection'], kcal: true },
    { pattern: /^\s*Total Entropy:\s+(\S+)\s+cal\/mol\.K\s*$/u, fields: ['entropy'] },
  ],
  // The first row of the T/K table is the temperature of the THERMODYNAMIC summary.
  xtb: [
    { pattern: /^\s*(\S+)\s+\S+\s+\S+\s+(\S+)\s+\S+\s*$/u, fields: ['temperature', 'entropyTerm'], header: /^\s*T\/K\s+H\(0\)-H\(T\)\+PV\s+H\(T\)\/Eh\s+T\*S\/Eh\s+G\(T\)\/Eh\s*$/u },
    { pattern: /^\s*:: zero point energy\s+(\S+) Eh\s+::\s*$/u, fields: ['zeroPoint'] },
    { pattern: /^\s*\| TOTAL ENTHALPY\s+(\S+) Eh\s+\|\s*$/u, fields: ['enthalpy'] },
    { pattern: /^\s*\| TOTAL FREE ENERGY\s+(\S+) Eh\s+\|\s*$/u, fields: ['gibbs'] },
  ],
};

const printed = new WeakMap<ScientificFrame, Partial<Record<Printed, number>>>();

/**
 * Reads one line of a program's thermochemistry print into the frame it belongs to. Corrections
 * become absolute values with the frame's energy, and the frame's summary is rebuilt each time.
 */
export function readThermochemistryLine(program: ThermochemistryProgram, lines: readonly string[], i: number, frame: ScientificFrame | undefined) {
  if (!frame) return false;
  const rule = RULES[program].find(({ pattern, header }) => pattern.test(lines[i]) && (!header || header.test(lines[i - 2] ?? '')));
  if (!rule) return false;
  const values = printed.get(frame) ?? {};
  const match = lines[i].match(rule.pattern)!;
  rule.fields.forEach((field, k) => { values[field] = numeric(match[k + 1]) / (rule.kcal ? HARTREE_KCAL_MOL : 1); });
  printed.set(frame, values);
  const summary = thermochemistry(values, frame.energyHartree);
  if (summary) frame.thermochemistry = summary;
  return true;
}

export function thermochemistry(values: Partial<Record<Printed, number>>, electronicHartree: number | undefined): Thermochemistry | undefined {
  const temperatureKelvin = values.temperature;
  if (temperatureKelvin === undefined || !(temperatureKelvin > 0)) return undefined;
  const enthalpyHartree = values.enthalpy ?? (values.enthalpyCorrection === undefined || electronicHartree === undefined ? undefined : electronicHartree + values.enthalpyCorrection);
  const entropyCalMolKelvin = values.entropy ?? (values.entropyTerm === undefined ? undefined : values.entropyTerm * HARTREE_KCAL_MOL * 1000 / temperatureKelvin);
  const gibbsHartree = values.gibbs ?? (enthalpyHartree === undefined || entropyCalMolKelvin === undefined ? undefined
    : enthalpyHartree - temperatureKelvin * entropyCalMolKelvin / (1000 * HARTREE_KCAL_MOL));
  return { temperatureKelvin, ...(values.zeroPoint === undefined ? {} : { zeroPointHartree: values.zeroPoint }),
    ...(enthalpyHartree === undefined ? {} : { enthalpyHartree }), ...(gibbsHartree === undefined ? {} : { gibbsHartree }),
    ...(entropyCalMolKelvin === undefined ? {} : { entropyCalMolKelvin }) };
}

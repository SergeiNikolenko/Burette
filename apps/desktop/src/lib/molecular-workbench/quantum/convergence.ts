import type { ConvergenceValue, OptimizationConvergence, ScientificFrame } from '../scientific-types';
import { numeric } from './reader-values';

export type ConvergenceProgram = 'gaussian' | 'orca' | 'psi4' | 'nwchem' | 'qchem' | 'gamess';
type Item = keyof OptimizationConvergence;

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?$/u;
// Psi4's columns, and NWChem's step columns, map onto these items.
const PSI4_COLUMNS: Item[] = ['energyChange', 'maxForce', 'rmsForce', 'maxStep', 'rmsStep'];
const NWCHEM_THRESHOLDS: [RegExp, Item][] = [
  [/^\s*maximum gradient threshold\s+\(gmax\)\s*=\s*(\S+)\s*$/u, 'maxForce'],
  [/^\s*rms gradient threshold\s+\(grms\)\s*=\s*(\S+)\s*$/u, 'rmsForce'],
  [/^\s*maximum cartesian step threshold\s+\(xmax\)\s*=\s*(\S+)\s*$/u, 'maxStep'],
  [/^\s*rms cartesian step threshold\s+\(xrms\)\s*=\s*(\S+)\s*$/u, 'rmsStep'],
];
// Item rows of the tables that start with a header line: label, value, threshold, converged flag.
const TABLE_ROWS: Partial<Record<ConvergenceProgram, { header: RegExp; rows: [RegExp, Item][] }>> = {
  gaussian: { header: /^\s*Item\s+Value\s+Threshold\s+Converged\?\s*$/u, rows: [
    [/^\s*Maximum Force\s+(\S+)\s+(\S+)\s+(?:YES|NO)\s*$/u, 'maxForce'], [/^\s*RMS\s+Force\s+(\S+)\s+(\S+)\s+(?:YES|NO)\s*$/u, 'rmsForce'],
    [/^\s*Maximum Displacement\s+(\S+)\s+(\S+)\s+(?:YES|NO)\s*$/u, 'maxStep'], [/^\s*RMS\s+Displacement\s+(\S+)\s+(\S+)\s+(?:YES|NO)\s*$/u, 'rmsStep']] },
  orca: { header: /\|Geometry convergence\|/u, rows: [
    [/^\s*RMS gradient\s+(\S+)\s+(\S+)\s+(?:YES|NO)\s*$/u, 'rmsForce'], [/^\s*MAX gradient\s+(\S+)\s+(\S+)\s+(?:YES|NO)\s*$/u, 'maxForce'],
    [/^\s*RMS step\s+(\S+)\s+(\S+)\s+(?:YES|NO)\s*$/u, 'rmsStep'], [/^\s*MAX step\s+(\S+)\s+(\S+)\s+(?:YES|NO)\s*$/u, 'maxStep'],
    [/^\s*Energy change\s+(\S+)\s+(\S+)\s+(?:YES|NO)\s*$/u, 'energyChange']] },
  qchem: { header: /^\s*Maximum\s+Tolerance\s+Cnvgd\?\s*$/u, rows: [
    [/^\s*Gradient\s+(\S+)\s+(\S+)\s+(?:YES|NO)\s*$/u, 'maxForce'], [/^\s*Displacement\s+(\S+)\s+(\S+)\s+(?:YES|NO)\s*$/u, 'maxStep'],
    [/^\s*Energy change\s+(\S+)\s+(\S+)\s+(?:YES|NO)\s*$/u, 'energyChange']] },
};

/** NWChem and GAMESS print their thresholds once, before the first step of one output. */
const printedThresholds = new WeakMap<readonly string[], Partial<Record<Item, number>>>();

/** A printed number, or undefined for a Fortran overflow such as `*********`. */
const value = (token: string | undefined) => token !== undefined && NUMBER.test(token) ? numeric(token) : undefined;

function set(frame: ScientificFrame, item: Item, printed: number | undefined, threshold?: number) {
  if (printed === undefined || !(Math.abs(printed) < 1e6)) return;
  // The first step has no previous energy: programs print zero, or the energy itself (Psi4 to three digits).
  if (item === 'energyChange' && (printed === 0 || (frame.energyHartree !== undefined && Math.abs(printed - frame.energyHartree) <= 0.01 * Math.abs(frame.energyHartree)))) return;
  const entry: ConvergenceValue = { value: Math.abs(printed), ...(threshold !== undefined && threshold > 0 ? { threshold } : {}) };
  frame.convergence = { ...frame.convergence, [item]: entry };
}

/**
 * Reads one geometry convergence print of an optimization into the geometry it was computed at:
 * the frame printed last. Returns the last line it read, or -1 when line `i` starts no such print.
 */
export function readConvergence(program: ConvergenceProgram, lines: readonly string[], i: number, frame: ScientificFrame | undefined): number {
  const line = lines[i];
  if (program === 'nwchem') {
    for (const [pattern, item] of NWCHEM_THRESHOLDS) {
      const match = line.match(pattern);
      if (match) { printedThresholds.set(lines, { ...printedThresholds.get(lines), [item]: value(match[1]) }); return i; }
    }
    // `@ Step Energy ΔE Gmax Grms Xrms Xmax Walltime`; the summary at the end repeats the last row.
    const row = line.match(/^@\s+\d+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\S+\s*$/u);
    if (!row || !frame) return -1;
    const energy = value(row[1]);
    // The row's energy names its geometry; a row of another geometry is not this frame's.
    if (energy === undefined || frame.energyHartree === undefined || Math.abs(energy - frame.energyHartree) > 1e-6) return i;
    const thresholds = printedThresholds.get(lines) ?? {};
    (['energyChange', 'maxForce', 'rmsForce', 'rmsStep', 'maxStep'] as const).forEach((item, k) => set(frame, item, value(row[k + 2]), thresholds[item]));
    return i;
  }
  if (program === 'gamess') {
    // A search converges when the largest gradient component is below OPTTOL and the RMS gradient below OPTTOL/3.
    const tolerance = line.match(/^\s*OPTTOL\s*=\s*(\S+)/u);
    if (tolerance) {
      const opttol = value(tolerance[1]);
      if (opttol !== undefined) printedThresholds.set(lines, { maxForce: opttol, rmsForce: opttol / 3 });
      return i;
    }
    // `NSERCH: n  E= energy  GRAD. MAX= value  R.M.S.= value` closes the step of the geometry whose energy it repeats.
    const row = line.match(/^\s*NSERCH:\s*\d+\s+E=\s*(\S+)\s+GRAD\. MAX=\s*(\S+)\s+R\.M\.S\.=\s*(\S+)\s*$/u);
    if (!row || !frame) return -1;
    const energy = value(row[1]);
    if (energy === undefined || frame.energyHartree === undefined || Math.abs(energy - frame.energyHartree) > 1e-6) return i;
    const thresholds = printedThresholds.get(lines) ?? {};
    set(frame, 'maxForce', value(row[2]), thresholds.maxForce);
    set(frame, 'rmsForce', value(row[3]), thresholds.rmsForce);
    return i;
  }
  if (program === 'psi4') {
    if (!/^\s*Step\s+Total Energy\s+Delta E\s+Max Force\s+RMS Force\s+Max Disp\s+RMS Disp/u.test(line) || !frame) return -1;
    // Dashes, the criteria row, dashes, then this step's row. Criteria are `value *` when
    // active, a lone `o` when inactive; step values may carry `*` (met) or `o` (inactive).
    const criteria = lines[i + 2]?.match(/^\s*Convergence Criteria(.*)$/u);
    const step = lines[i + 4]?.replace(/~\s*$/u, '').trim().split(/\s+/u).filter(token => NUMBER.test(token));
    if (!criteria || !step || step.length !== 7) return -1;
    if (frame.energyHartree === undefined || Math.abs(numeric(step[1]) - frame.energyHartree) > 1e-6) return i + 4;
    const thresholds: (number | undefined)[] = [];
    const tokens = criteria[1].replace(/~\s*$/u, '').trim().split(/\s+/u).filter(Boolean);
    for (let k = 0; k < tokens.length; k++) {
      if (tokens[k] === 'o') thresholds.push(undefined);
      else if (NUMBER.test(tokens[k])) { thresholds.push(numeric(tokens[k])); if (tokens[k + 1] === '*') k++; }
    }
    PSI4_COLUMNS.forEach((item, k) => set(frame, item, value(step[k + 2]), thresholds[k]));
    return i + 4;
  }
  const table = TABLE_ROWS[program];
  if (!table?.header.test(line) || !frame) return -1;
  let j = i + 1;
  for (; j < lines.length && j <= i + 8; j++) {
    const rule = table.rows.find(([pattern]) => pattern.test(lines[j]));
    if (!rule) continue;
    const match = lines[j].match(rule[0])!;
    set(frame, rule[1], value(match[1]), value(match[2]));
  }
  return i;
}

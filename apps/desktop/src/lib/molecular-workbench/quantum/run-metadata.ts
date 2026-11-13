import type { CalculationMetadata } from '../scientific-types';

const clip = (value: string) => value.replace(/\s+/gu, ' ').trim().slice(0, 512);

/**
 * ORCA's banner version, the echoed `!` keyword lines, the basis it reports, the charge and
 * multiplicity of the first SCF setup, the termination banner and `TOTAL RUN TIME`.
 */
export function orcaMetadata(lines: readonly string[]): CalculationMetadata | undefined {
  const metadata: CalculationMetadata = {};
  const keywords: string[] = [];
  for (const line of lines) {
    let match = line.match(/^\s*Program Version\s+(\S+)/u);
    if (match && !metadata.program) { metadata.program = `ORCA ${match[1]}`; continue; }
    match = line.match(/^\|\s*\d+>\s*!\s*(.*)$/u);
    if (match) { if (match[1].trim()) keywords.push(match[1]); continue; }
    match = line.match(/^Your calculation utilizes the basis:\s*(.+)$/u);
    if (match && !metadata.basis) { metadata.basis = clip(match[1]); continue; }
    match = line.match(/^\s*Total Charge\s+Charge\s+\.{3,}\s*(-?\d+)\s*$/u);
    if (match && metadata.charge === undefined) { metadata.charge = Number(match[1]); continue; }
    match = line.match(/^\s*Multiplicity\s+Mult\s+\.{3,}\s*(\d+)\s*$/u);
    if (match && metadata.multiplicity === undefined) { metadata.multiplicity = Number(match[1]); continue; }
    if (/\*{4}ORCA TERMINATED NORMALLY\*{4}/u.test(line)) { metadata.termination = 'normal'; continue; }
    if (/ORCA finished by error termination|aborting the run/u.test(line)) { metadata.termination = 'error'; continue; }
    match = line.match(/^TOTAL RUN TIME:\s*(\d+) days (\d+) hours (\d+) minutes (\d+) seconds (\d+) msec/u);
    if (match) metadata.runSeconds = ((Number(match[1]) * 24 + Number(match[2])) * 60 + Number(match[3])) * 60 + Number(match[4]) + Number(match[5]) / 1000;
  }
  if (keywords.length) metadata.keywords = clip(keywords.join(' '));
  return Object.keys(metadata).length ? metadata : undefined;
}

/**
 * xtb's banner version, its Hamiltonian with the command-line options (a GFN-FF run is named by
 * its --gfnff option), the net charge and unpaired electrons, the termination line and the total
 * wall time.
 */
export function xtbMetadata(lines: readonly string[], forceField: boolean): CalculationMetadata | undefined {
  const metadata: CalculationMetadata = {};
  let hamiltonian: string | undefined, options: string | undefined, total = false;
  for (const line of lines) {
    let match = line.match(/^\s*\* xtb version (\S+)/u);
    if (match && !metadata.program) { metadata.program = `xtb ${match[1]}`; continue; }
    match = line.match(/^\s*program call\s*:\s*\S+\s+(.*)$/u);
    // The first argument is the coordinate file; the rest are the job's options.
    if (match && options === undefined) { options = match[1].trim().split(/\s+/u).filter((token, k) => k > 0 || token.startsWith('-')).join(' '); continue; }
    match = line.match(/^\s*:\s*Hamiltonian\s+(\S+)\s*:\s*$/u);
    if (match && !forceField) { hamiltonian ??= match[1]; continue; }
    match = line.match(/^\s*:\s*net charge\s+(-?\d+)\s*:\s*$/u);
    if (match && metadata.charge === undefined) { metadata.charge = Number(match[1]); continue; }
    match = line.match(/^\s*:\s*unpaired electrons\s+(\d+)\s*:\s*$/u);
    if (match && metadata.multiplicity === undefined) { metadata.multiplicity = Number(match[1]) + 1; continue; }
    if (/^\s*normal termination of xtb\s*$/u.test(line)) { metadata.termination = 'normal'; continue; }
    if (/^\s*abnormal termination of xtb\s*$/u.test(line)) { metadata.termination = 'error'; continue; }
    if (/^\s*total:\s*$/u.test(line)) { total = true; continue; }
    match = total ? line.match(/^\s*\* wall-time:\s*(\d+) d,\s*(\d+) h,\s*(\d+) min,\s*(\S+) sec\s*$/u) : null;
    if (match) { metadata.runSeconds = ((Number(match[1]) * 24 + Number(match[2])) * 60 + Number(match[3])) * 60 + Number(match[4]); total = false; }
  }
  const keywords = [hamiltonian, options].filter(Boolean).join(' ');
  if (keywords) metadata.keywords = clip(keywords);
  return Object.keys(metadata).length ? metadata : undefined;
}

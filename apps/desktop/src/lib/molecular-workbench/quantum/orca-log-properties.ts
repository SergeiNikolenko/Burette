import type { AtomicChargeSet, ScientificFrame } from '../scientific-types';
import type { Vec3 } from '../types';
import { DEBYE_PER_AU } from './output-history';
import { BOHR, numeric } from './reader-values';
import { readThermochemistryLine } from './thermochemistry';
import { readConvergence } from './convergence';

const HARTREE_KCAL_MOL = 627.5094740631;

function replaceSet(sets: AtomicChargeSet[] | undefined, model: AtomicChargeSet['model'], values: number[]) {
  return [...(sets ?? []).filter(set => set.model !== model), { model, values }];
}

/**
 * Rows `n El : charge [spin]` (Mulliken, Löwdin) or `n El charge spin` (Hirshfeld) from line `start`,
 * numbered from 0 in atom order. Returns the charges, the spins when printed, and the first other line.
 */
function populationRows(lines: readonly string[], start: number, frame: ScientificFrame, colon: boolean) {
  const charges: number[] = [], spins: number[] = [];
  let j = start;
  for (; j < lines.length; j++) {
    const row = lines[j].match(colon ? /^\s*(\d+)\s+([A-Z][a-z]?)\s*:\s*(\S+)(?:\s+(\S+))?\s*$/u : /^\s*(\d+)\s+([A-Z][a-z]?)\s+(\S+)\s+(\S+)\s*$/u);
    if (!row) break;
    if (Number(row[1]) !== charges.length || row[2] !== frame.atoms[charges.length]?.element) throw new Error('Malformed ORCA atomic charge row.');
    charges.push(numeric(row[3]));
    if (row[4] !== undefined) spins.push(numeric(row[4]));
  }
  if (charges.length !== frame.atoms.length || (spins.length && spins.length !== charges.length)) throw new Error('ORCA atomic charges do not match the atoms.');
  return { charges, spins, end: j };
}

/**
 * One property print of an ORCA text output, for the geometry printed before it: Mulliken, Löwdin
 * and Hirshfeld charges with their spin populations, ⟨S²⟩, the Cartesian gradient as forces, the
 * total dipole in a.u., the geometry convergence of an optimization step and the thermochemistry.
 * Returns the last line it read, or -1 when line `i` starts no such print.
 */
export function readOrcaLogProperty(lines: readonly string[], i: number, frame: ScientificFrame) {
  const charges = lines[i].match(/^(MULLIKEN|LOEWDIN) ATOMIC CHARGES( AND SPIN (?:POPULATIONS|DENSITIES))?\s*$/u);
  if (charges && /^-+\s*$/u.test(lines[i + 1] ?? '')) {
    const model = charges[1] === 'MULLIKEN' ? 'mulliken' : 'lowdin';
    const rows = populationRows(lines, i + 2, frame, true);
    frame.charges = replaceSet(frame.charges, model, rows.charges);
    if (charges[2] && rows.spins.length) frame.spinPopulations = replaceSet(frame.spinPopulations, model, rows.spins);
    return rows.end - 1;
  }
  if (/^HIRSHFELD ANALYSIS\s*$/u.test(lines[i]) && /^-+\s*$/u.test(lines[i + 1] ?? '')) {
    let j = i + 2;
    while (j < lines.length && j < i + 8 && !/^\s*ATOM\s+CHARGE\s+SPIN\s*$/u.test(lines[j])) j++;
    if (j >= lines.length || j >= i + 8) return -1;
    const rows = populationRows(lines, j + 1, frame, false);
    frame.charges = replaceSet(frame.charges, 'hirshfeld', rows.charges);
    // A closed shell prints a column of zero spins.
    if (rows.spins.some(spin => spin !== 0)) frame.spinPopulations = replaceSet(frame.spinPopulations, 'hirshfeld', rows.spins);
    return rows.end - 1;
  }
  const spinSquared = lines[i].match(/^Expectation value of <S\*\*2>\s*:\s*(\S+)\s*$/u);
  if (spinSquared) { frame.spinSquared = numeric(spinSquared[1]); return i; }
  if (/^CARTESIAN GRADIENT\s*$/u.test(lines[i]) && /^-+\s*$/u.test(lines[i + 1] ?? '')) {
    const forces: Vec3[] = [];
    let j = i + 2;
    while (j < lines.length && !lines[j].trim()) j++;
    for (; j < lines.length; j++) {
      const row = lines[j].match(/^\s*(\d+)\s+([A-Z][a-z]?)\s*:\s*(\S+)\s+(\S+)\s+(\S+)\s*$/u);
      if (!row) break;
      if (Number(row[1]) !== forces.length + 1 || row[2] !== frame.atoms[forces.length]?.element) throw new Error('Malformed ORCA gradient row.');
      // Hartree per bohr to the force in kcal/(mol·Å).
      forces.push(row.slice(3, 6).map(value => -numeric(value) * HARTREE_KCAL_MOL / BOHR) as Vec3);
    }
    if (forces.length !== frame.atoms.length) throw new Error('ORCA gradient does not match the atoms.');
    frame.forcesKcalMolAngstrom = forces;
    return j - 1;
  }
  const dipole = lines[i].match(/^Total Dipole Moment\s+:\s+(\S+)\s+(\S+)\s+(\S+)\s*$/u);
  if (dipole) {
    frame.dipoleDebye = dipole.slice(1, 4).map(value => numeric(value) * DEBYE_PER_AU) as Vec3;
    return i;
  }
  const convergence = readConvergence('orca', lines, i, frame);
  if (convergence >= 0) return convergence;
  return readThermochemistryLine('orca', lines, i, frame) ? i : -1;
}

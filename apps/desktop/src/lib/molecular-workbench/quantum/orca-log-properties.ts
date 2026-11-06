import type { ScientificFrame } from '../scientific-types';
import type { Vec3 } from '../types';
import { DEBYE_PER_AU } from './output-history';
import { numeric } from './reader-values';
import { readThermochemistryLine } from './thermochemistry';

/**
 * One property print of an ORCA text output, for the geometry printed before it: Mulliken or
 * Löwdin charges (spin populations follow in a second column), the total dipole in a.u. and the
 * thermochemistry. Returns the last line it read, or -1 when line `i` starts no such print.
 */
export function readOrcaLogProperty(lines: readonly string[], i: number, frame: ScientificFrame) {
  const charges = lines[i].match(/^(MULLIKEN|LOEWDIN) ATOMIC CHARGES(?: AND SPIN (?:POPULATIONS|DENSITIES))?\s*$/u);
  if (charges && /^-+\s*$/u.test(lines[i + 1] ?? '')) {
    const model = charges[1] === 'MULLIKEN' ? 'mulliken' : 'lowdin';
    const values: number[] = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const row = lines[j].match(/^\s*(\d+)\s+([A-Z][a-z]?)\s*:\s*(\S+)(?:\s+\S+)?\s*$/u);
      if (!row) break;
      if (Number(row[1]) !== values.length || row[2] !== frame.atoms[values.length]?.element) throw new Error('Malformed ORCA atomic charge row.');
      values.push(numeric(row[3]));
    }
    if (values.length !== frame.atoms.length) throw new Error('ORCA atomic charges do not match the atoms.');
    frame.charges = [...(frame.charges ?? []).filter(set => set.model !== model), { model, values }];
    return j - 1;
  }
  const dipole = lines[i].match(/^Total Dipole Moment\s+:\s+(\S+)\s+(\S+)\s+(\S+)\s*$/u);
  if (dipole) {
    frame.dipoleDebye = dipole.slice(1, 4).map(value => numeric(value) * DEBYE_PER_AU) as Vec3;
    return i;
  }
  return readThermochemistryLine('orca', lines, i, frame) ? i : -1;
}

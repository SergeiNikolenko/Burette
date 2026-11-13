import type { MolecularAtom, Vec3 } from '../types';
import type { AtomicChargeSet, MolecularOrbital, ScientificDocument, VibrationalMode } from '../scientific-types';
import { coordinate, numeric } from './reader-values';
import { OutputHistory, orbitalTable, outputLines } from './output-history';
import { readThermochemistryLine } from './thermochemistry';
import { readConvergence } from './convergence';

const CHARGE_TABLES: [RegExp, AtomicChargeSet['model']][] = [
  [/^\s*Ground-State Mulliken Net Atomic Charges\s*$/u, 'mulliken'],
  [/^\s*Ground-State ChElPG Net Atomic Charges\s*$/u, 'chelpg'],
  [/^\s*Hirshfeld Atomic Charges\s*$/u, 'hirshfeld'],
  [/^\s*Charge Model 5\s*$/u, 'cm5'],
  [/^\s*Merz-Kollman ESP Net Atomic Charges\s*$/u, 'esp'],
];
const CORRELATED_ENERGY = /^\s*(?:MP2|MP3|MP4|MP4SDQ|CCD|CCSD|CCSD\(T\)|QCISD|QCISD\(T\)|CISD)\s+total energy\s*=\s*(-\d+\.\d+)(?:\s+au)?\s*$/u;
const ORBITAL_ENERGY = /-?\d+\.\d{3}/gu;

/** `-- Occupied --` / `-- Virtual --` lists of three-decimal energies, each optionally followed by `n Label` symmetry pairs. */
function orbitalEnergies(lines: string[], start: number) {
  const rows: { energyHartree: number; occupied: boolean; symmetry?: string }[] = [];
  let occupied: boolean | undefined, i = start;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*-- Occupied --\s*$/u.test(line)) { occupied = true; continue; }
    if (/^\s*-- Virtual --\s*$/u.test(line)) { occupied = false; continue; }
    if (occupied === undefined || !line.trim()) break;
    const values = line.match(ORBITAL_ENERGY);
    if (!values || line.replace(ORBITAL_ENERGY, '').trim()) {
      const pairs = line.trim().split(/\s+/);
      const block = rows.filter(row => row.symmetry === undefined).slice(-pairs.length / 2);
      if (pairs.length % 2 || !pairs.every((token, k) => k % 2 ? /^[A-Za-z][\w'"]*$/u.test(token) : /^\d+$/u.test(token))) break;
      if (block.length !== pairs.length / 2) throw new Error('Malformed Q-Chem orbital symmetry row.');
      block.forEach((row, k) => { row.symmetry = pairs[2 * k + 1]; });
      continue;
    }
    const block = occupied;
    rows.push(...values.map(value => ({ energyHartree: numeric(value), occupied: block })));
  }
  return { rows, end: i };
}

/**
 * Q-Chem 4–6 output (https://manual.q-chem.com): `Standard Nuclear Orientation (Angstroms)` per
 * SCF; `Total energy in the final basis set` in Hartree (SCF or DFT); orbital energies in Hartree
 * to 0.001; normal modes as Cartesian displacements, IR in km/mol, Raman in Å⁴/amu. MO coefficients
 * printed by `print_orbitals` are truncated to five decimals: the FCHK (`gui = 2`) or Molden file of
 * the same job carries them.
 */
export function parseQchemLog(text: string): ScientificDocument {
  const lines = outputLines(text);
  const history = new OutputHistory();
  let converged: boolean | undefined;
  let orbitals: { frame: number; alpha?: ReturnType<typeof orbitalEnergies>['rows']; beta?: ReturnType<typeof orbitalEnergies>['rows']; unrestricted: boolean } = { frame: -1, unrestricted: false };
  // Q-Chem 5.4 can print a second table under the same heading (orbital-by-orbital populations): the first per SCF counts.
  let models = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*Standard Nuclear Orientation \((?:Angstroms|Bohr)\)\s*$/u.test(line)) {
      const scale = /Bohr/u.test(line) ? 0.529177210903 : 1;
      if (!/^\s*I\s+Atom\s+X\s+Y\s+Z\s*$/u.test(lines[i + 1] ?? '') || !/^\s*-{5,}/u.test(lines[i + 2] ?? '')) break;
      const atoms: MolecularAtom[] = [];
      let j = i + 3;
      for (; j < lines.length && !/^\s*-{5,}/u.test(lines[j]); j++) {
        const p = lines[j].trim().split(/\s+/);
        if (p.length !== 5 || Number(p[0]) !== atoms.length + 1) throw new Error('Malformed Q-Chem geometry row.');
        if (/^Gh/iu.test(p[1])) throw new Error('Q-Chem ghost atoms are not supported.');
        atoms.push(coordinate(p[1][0].toUpperCase() + p[1].slice(1).toLowerCase(), p.slice(2).map(numeric), scale));
      }
      if (j >= lines.length || !atoms.length) break;
      history.geometry(atoms);
      models = new Set();
      i = j;
      continue;
    }
    if (readThermochemistryLine('qchem', lines, i, history.frames.at(-1))) continue;
    const convergenceEnd = readConvergence('qchem', lines, i, history.frames.at(-1));
    if (convergenceEnd >= 0) { i = convergenceEnd; continue; }
    let match = line.match(/^\s*Total energy in the final basis set\s*=\s*(\S+)\s*$/u);
    if (match) { history.scfEnergy(numeric(match[1])); models = new Set(); continue; }
    match = line.match(CORRELATED_ENERGY);
    if (match) { history.correlatedEnergy(numeric(match[1])); continue; }
    if (/^\s*\*\*\s+OPTIMIZATION CONVERGED\s+\*\*\s*$/u.test(line)) converged = true;
    if (/SCF failed to converge|MAXIMUM OPTIMIZATION CYCLES REACHED|Q-Chem fatal error occurred/u.test(line)) converged = false;
    match = line.match(/^\s*(Alpha|Beta) MOs, (Restricted|Unrestricted)\s*$/u);
    if (match) {
      const { rows, end } = orbitalEnergies(lines, i + 1);
      if (end >= lines.length) break;
      i = end - 1;
      if (history.trial) continue;
      const frame = history.frames.length - 1;
      if (match[1] === 'Alpha') orbitals = { frame, alpha: rows, unrestricted: match[2] === 'Unrestricted' };
      else if (orbitals.frame === frame) orbitals.beta = rows;
      continue;
    }
    const table = CHARGE_TABLES.find(([pattern]) => pattern.test(line));
    if (table) {
      const frame = history.current('charges');
      let j = i + 1;
      while (j < lines.length && !/^\s*-{5,}/u.test(lines[j])) j++;
      const values: number[] = [];
      for (j++; j < lines.length && !/^\s*-{5,}/u.test(lines[j]); j++) {
        const p = lines[j].trim().split(/\s+/);
        // Unrestricted tables add a spin-population column.
        if ((p.length !== 3 && p.length !== 4) || Number(p[0]) !== values.length + 1) throw new Error('Malformed Q-Chem charge row.');
        values.push(numeric(p[2]));
      }
      if (j >= lines.length) break;
      if (values.length === frame.atoms.length && !models.has(table[1])) history.charges(table[1], values);
      models.add(table[1]);
      i = j;
      continue;
    }
    if (/^\s*Dipole Moment \(Debye\)\s*$/u.test(line)) {
      match = (lines[i + 1] ?? '').match(/^\s*X\s+(\S+)\s+Y\s+(\S+)\s+Z\s+(\S+)\s*$/u);
      if (i + 1 >= lines.length) break;
      if (!match) throw new Error('Malformed Q-Chem dipole row.');
      history.dipole([numeric(match[1]), numeric(match[2]), numeric(match[3])]);
      continue;
    }
    if (/^\s*Mode:\s+\d/u.test(line)) {
      const frame = history.current('normal modes');
      const numbers = line.split(':')[1].trim().split(/\s+/).map(Number);
      const block: VibrationalMode[] = numbers.map(number => ({ index: number - 1, frequencyCm1: NaN }));
      const active: Record<string, boolean[]> = {};
      let j = i + 1;
      for (; j < lines.length && !/^\s*X\s+Y\s+Z/u.test(lines[j]); j++) {
        const property = lines[j].match(/^\s*([A-Za-z. ]+):\s+(.*)$/u);
        if (!property) throw new Error('Malformed Q-Chem normal-mode block.');
        const values = property[2].trim().split(/\s+/);
        if (values.length !== block.length) throw new Error('Malformed Q-Chem normal-mode property.');
        const name = property[1].trim();
        if (name.endsWith('Active')) { active[name] = values.map(value => value === 'YES'); continue; }
        const key = ({ Frequency: 'frequencyCm1', 'Force Cnst': 'forceConstantMdynAngstrom', 'Red. Mass': 'reducedMassAmu', 'IR Intens': 'intensityKmMol',
          'Raman Intens': 'ramanActivityAngstrom4Amu', Depolar: 'ramanDepolarizationRatio' } as const)[name];
        if (!key) throw new Error(`Unrecognised Q-Chem normal-mode property ${name}.`);
        block.forEach((mode, k) => { mode[key] = numeric(values[k]); });
      }
      // A depolarization ratio of a Raman-inactive mode is printed as 0 but is undefined.
      block.forEach((mode, k) => { if (active['Raman Active'] && !active['Raman Active'][k]) delete mode.ramanDepolarizationRatio; });
      const vectors = block.map(() => [] as Vec3[]);
      for (let a = 0; a < frame.atoms.length; a++) {
        if (++j >= lines.length) return document();
        const p = lines[j].trim().split(/\s+/);
        if (p.length !== 1 + 3 * block.length || p[0].toLowerCase() !== frame.atoms[a].element.toLowerCase()) throw new Error('Malformed Q-Chem normal-mode row.');
        const values = p.slice(1).map(numeric);
        block.forEach((_, k) => vectors[k].push(values.slice(3 * k, 3 * k + 3) as Vec3));
      }
      if (block.some(mode => !Number.isFinite(mode.frequencyCm1))) throw new Error('Q-Chem normal mode without a frequency.');
      block.forEach((mode, k) => { mode.displacements = vectors[k]; });
      // A new analysis restarts at mode 1.
      frame.modes = [...(numbers[0] === 1 ? [] : frame.modes ?? []), ...block];
      if (frame.modes.length > frame.atoms.length * 3) throw new Error('Q-Chem mode count exceeds the geometry.');
      i = j;
    }
  }
  return document();

  function document(): ScientificDocument {
    const reference = history.frames.length - 1;
    const list = (spin: 'alpha' | 'beta', rows = orbitals[spin]): MolecularOrbital[] => !rows ? []
      : orbitalTable(spin, rows.map(({ energyHartree, occupied, symmetry }) => ({ energyHartree, occupancy: occupied ? (orbitals.unrestricted ? 1 : 2) : 0, ...(symmetry ? { symmetry } : {}) })));
    const all = orbitals.frame !== reference || !orbitals.alpha ? [] : [...list('alpha'), ...(orbitals.unrestricted ? list('beta') : [])];
    return history.document('qchem-log', all, converged);
  }
}

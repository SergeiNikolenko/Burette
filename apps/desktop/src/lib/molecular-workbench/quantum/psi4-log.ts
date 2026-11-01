import { atomicNumber } from '../elements';
import type { MolecularAtom, Vec3 } from '../types';
import type { MolecularOrbital, ScientificDocument, VibrationalMode } from '../scientific-types';
import { hessianFromSquare } from '../hessian';
import { BOHR, coordinate, numeric } from './reader-values';
import { DEBYE_PER_AU, OutputHistory, orbitalTable, outputLines } from './output-history';

const GEOMETRY = /^\s*Geometry \(in (Angstrom|Bohr)\), charge = -?\d+, multiplicity = \d+:\s*$/u;
const SCF_ENERGY = /^\s*@\S*?(?:RHF|UHF|ROHF|CUHF|RKS|UKS|ROKS) Final Energy:\s+(\S+)\s*$/u;
// Post-Hartree–Fock totals as the Psi4 modules print them; the last level of a geometry wins.
const CORRELATED_ENERGY = /^\s*(?:\*\s*)?(?:(?:SCS-)?MP2(?:\.5)?|MP3|MP4|CCSD|CCSD\(T\)|CISD|QCISD|QCISD\(T\)|CEPA\(0\)|FNO-CCSD\(T\)) (?:[Tt]otal [Ee]nergy|Total Energy \(a\.u\.\))\s*[:=]\s*(-\d+\.\d+)(?:\s*\[Eh\])?\s*$/u;
const SECTIONS: Record<string, { spin: 'alpha' | 'beta'; occupancy: number }> = {
  'Doubly Occupied:': { spin: 'alpha', occupancy: 2 }, 'Singly Occupied:': { spin: 'alpha', occupancy: 1 }, 'Virtual:': { spin: 'alpha', occupancy: 0 },
  'Alpha Occupied:': { spin: 'alpha', occupancy: 1 }, 'Alpha Virtual:': { spin: 'alpha', occupancy: 0 },
  'Beta Occupied:': { spin: 'beta', occupancy: 1 }, 'Beta Virtual:': { spin: 'beta', occupancy: 0 },
};

function element(label: string) {
  if (/^Gh\(/u.test(label)) throw new Error('Psi4 ghost atoms are not supported.');
  const symbol = label.match(/^([A-Z][a-z]?)/u)?.[1];
  for (const candidate of symbol ? [symbol, symbol[0]] : []) { try { atomicNumber(candidate); return candidate; } catch { /* one letter */ } }
  throw new Error(`Unrecognised Psi4 atom label ${label}.`);
}

/** Matrix blocks of 1-based column numbers followed by `row value...` lines. */
function readMatrix(lines: string[], start: number, size: number) {
  const values = new Float64Array(size * size), seen = new Uint8Array(size * size);
  let columns: number[] = [], filled = 0, i = start;
  for (; i < lines.length && filled < size * size; i++) {
    const p = lines[i].trim().split(/\s+/);
    if (!lines[i].trim()) continue;
    if (p.every(token => /^\d+$/u.test(token))) { columns = p.map(token => Number(token) - 1); continue; }
    const row = Number(p[0]) - 1;
    if (!columns.length || !Number.isInteger(row) || row < 0 || row >= size || p.length !== columns.length + 1) throw new Error('Malformed Psi4 matrix.');
    columns.forEach((column, k) => {
      if (column >= size || seen[row * size + column]) throw new Error('Malformed Psi4 matrix.');
      seen[row * size + column] = 1; filled++;
      values[row * size + column] = numeric(p[k + 1]);
    });
  }
  return filled === size * size ? { values, end: i } : null;
}

/**
 * Psi4 1.2–1.11 output (https://psicode.org/psi4manual/master/): geometries in the printed
 * (reoriented) frame and unit, energies Hartree, orbital energies Hartree in energy order
 * with irrep labels, the vibrational analysis table (Cartesian displacements of each listed
 * vibration, frequencies cm^-1 with an `i` suffix for imaginary ones, IR km/mol) and the
 * total Hessian in Hartree/bohr².
 */
export function parsePsi4Log(text: string): ScientificDocument {
  const lines = outputLines(text);
  const history = new OutputHistory();
  let orbitals: MolecularOrbital[] = [], orbitalFrame = -1;
  let converged: boolean | undefined;
  // DF-MP2 prints its total in an energy box: `==> DF-MP2 Energies <==`, then `Total Energy = … [Eh]`.
  let energyBox = false;
  // The geometry table's mass column (amu), kept for the Hessian of that geometry.
  const masses = new WeakMap<object, number[]>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const geometry = line.match(GEOMETRY);
    if (geometry) {
      const scale = geometry[1] === 'Bohr' ? BOHR : 1;
      while (++i < lines.length && !lines[i].trim()) { /* blank */ }
      if (/^\s*Center\s+X\s+Y\s+Z/u.test(lines[i] ?? '')) i += 2;
      const atoms: MolecularAtom[] = [], atomMasses: number[] = [];
      for (; i < lines.length && lines[i].trim(); i++) {
        const p = lines[i].trim().split(/\s+/);
        if (p.length !== 4 && p.length !== 5) throw new Error('Malformed Psi4 geometry row.');
        atoms.push(coordinate(element(p[0]), p.slice(1, 4).map(numeric), scale));
        if (p.length === 5) atomMasses.push(numeric(p[4]));
      }
      if (i >= lines.length || !atoms.length) break;
      const frame = history.geometry(atoms);
      if (atomMasses.length === atoms.length) masses.set(frame, atomMasses);
      continue;
    }
    let match = line.match(SCF_ENERGY);
    if (match) { history.scfEnergy(numeric(match[1])); continue; }
    match = line.match(CORRELATED_ENERGY) ?? (energyBox ? line.match(/^\s*Total Energy\s*=\s*(-\d+\.\d+) \[Eh\]\s*$/u) : null);
    if (match) { history.correlatedEnergy(numeric(match[1])); energyBox = false; continue; }
    if (/=> (?:DF-|CD-|CONV-)?(?:MP2|MP2\.5|MP3) Energies <=/u.test(line)) { energyBox = true; continue; }
    if (/=> .* Energies <=/u.test(line)) energyBox = false;
    if (/^\s*Final optimized geometry and variables:/u.test(line)) converged = true;
    if (/Could not converge (?:SCF iterations|geometry optimization)|OptimizationConvergenceError|SCFConvergenceError/u.test(line)) converged = false;
    if (/^\s*Orbital Energies \[Eh\]\s*$/u.test(line)) {
      const rows: Record<'alpha' | 'beta', { energyHartree: number; occupancy: number; symmetry?: string }[]> = { alpha: [], beta: [] };
      let section: typeof SECTIONS[string] | undefined, j = i + 1;
      for (; j < lines.length; j++) {
        const trimmed = lines[j].trim();
        if (/^-+$/u.test(trimmed) || !trimmed) continue;
        if (SECTIONS[trimmed]) { section = SECTIONS[trimmed]; continue; }
        if (!section || !/^\d+[A-Za-z]/u.test(trimmed)) break;
        const tokens = trimmed.split(/\s+/);
        if (tokens.length % 2) throw new Error('Malformed Psi4 orbital energy row.');
        for (let k = 0; k < tokens.length; k += 2) {
          const label = tokens[k].match(/^\d+([A-Za-z][\w'"]*)$/u);
          if (!label) throw new Error('Malformed Psi4 orbital label.');
          rows[section.spin].push({ energyHartree: numeric(tokens[k + 1]), occupancy: section.occupancy, symmetry: label[1] });
        }
      }
      if (j >= lines.length) break;
      // Unrestricted or restricted, the energy order within one spin channel is the printed order.
      orbitals = [...orbitalTable('alpha', rows.alpha), ...(rows.beta.length ? orbitalTable('beta', rows.beta) : [])];
      orbitalFrame = history.trial ? -1 : history.frames.length - 1;
      i = j - 1;
      continue;
    }
    if (/^\s*(Mulliken|Lowdin) Charges: \(a\.u\.\)\s*$/u.test(line)) {
      const model = line.includes('Mulliken') ? 'mulliken' : 'lowdin';
      if (!/Center\s+Symbol\s+Alpha\s+Beta\s+Spin\s+Total/u.test(lines[i + 1] ?? '')) throw new Error('Unsupported Psi4 charge table.');
      const charges: number[] = [];
      for (i += 2; i < lines.length && /^\s*\d+\s+\S+\s/u.test(lines[i]); i++) {
        const p = lines[i].trim().split(/\s+/);
        if (p.length !== 6 || Number(p[0]) !== charges.length + 1) throw new Error('Malformed Psi4 charge row.');
        charges.push(numeric(p[5]));
      }
      if (i >= lines.length) break;
      history.charges(model, charges);
      continue;
    }
    // Psi4 ≥ 1.4 multipole table (a.u.) and the older debye block.
    if (/^\s*Dipole X\s+:/u.test(line)) {
      const vector = [0, 1, 2].map(axis => lines[i + axis]?.match(/^\s*Dipole [XYZ]\s+:\s+\S+\s+\S+\s+(\S+)\s*$/u)?.[1]);
      if (vector.every(Boolean)) history.dipole(vector.map(value => numeric(value!) * DEBYE_PER_AU) as Vec3);
      i += 2;
      continue;
    }
    if (/^\s*Dipole Moment: \[D\]\s*$/u.test(line)) {
      const match = lines[i + 1]?.match(/^\s*X:\s*(\S+)\s+Y:\s*(\S+)\s+Z:\s*(\S+)/u);
      if (match) history.dipole([numeric(match[1]), numeric(match[2]), numeric(match[3])]);
      continue;
    }
    if (/^\s*## Total Hessian \(Symmetry 0\) ##\s*$/u.test(line)) {
      const frame = history.current('Hessian');
      const size = frame.atoms.length * 3;
      if (!lines[i + 1]?.includes(`Size: ${size} x ${size}`)) throw new Error('Psi4 Hessian does not match the atoms.');
      const matrix = readMatrix(lines, i + 2, size);
      if (!matrix) break;
      frame.hessian = hessianFromSquare(matrix.values, frame.atoms.length, 'psi4-log', masses.get(frame));
      i = matrix.end - 1;
      continue;
    }
    if (/^\s*==> Harmonic Vibrational Analysis <==\s*$/u.test(line)) { history.current('normal modes').modes = []; continue; }
    if (/^\s*Vibration\s+\d+/u.test(line)) {
      const frame = history.current('normal modes');
      const numbers = line.trim().split(/\s+/).slice(1).map(Number);
      const block: VibrationalMode[] = numbers.map(number => {
        if (!Number.isInteger(number) || number < 1 || number > frame.atoms.length * 3) throw new Error('Invalid Psi4 vibration number.');
        return { index: number - 1, frequencyCm1: NaN };
      });
      let j = i + 1;
      for (; j < lines.length && !/^\s*-{10,}\s*$/u.test(lines[j]); j++) {
        const label = lines[j].match(/^\s*(Freq \[cm\^-1\]|Irrep|Reduced mass \[u\]|Force const \[mDyne\/A\]|IR activ \[km\/mol\])\s+(.*)$/u);
        if (!label) continue;
        const tokens = label[2].trim().split(/\s+/);
        if (label[1] !== 'Irrep' && tokens.length !== block.length) throw new Error('Malformed Psi4 vibration table.');
        block.forEach((mode, k) => {
          if (label[1] === 'Freq [cm^-1]') mode.frequencyCm1 = tokens[k].endsWith('i') ? -numeric(tokens[k].slice(0, -1)) : numeric(tokens[k]);
          else if (label[1] === 'Irrep') { if (tokens.length === block.length) mode.symmetry = tokens[k]; }
          else if (label[1] === 'Reduced mass [u]') mode.reducedMassAmu = numeric(tokens[k]);
          else if (label[1] === 'Force const [mDyne/A]') mode.forceConstantMdynAngstrom = numeric(tokens[k]);
          else { const value = numeric(tokens[k]); if (value < 0) throw new Error('Negative Psi4 IR activity.'); mode.intensityKmMol = value; }
        });
      }
      if (j + frame.atoms.length >= lines.length) break;
      block.forEach(mode => { if (!Number.isFinite(mode.frequencyCm1)) throw new Error('Psi4 vibration has no frequency.'); mode.displacements = []; });
      for (let atom = 0; atom < frame.atoms.length; atom++) {
        const p = lines[j + 1 + atom].trim().split(/\s+/);
        if (p.length !== 2 + 3 * block.length || Number(p[0]) !== atom + 1 || element(p[1]) !== frame.atoms[atom].element) throw new Error('Malformed Psi4 normal-mode row.');
        block.forEach((mode, k) => mode.displacements!.push(p.slice(2 + 3 * k, 5 + 3 * k).map(numeric) as Vec3));
      }
      const modes = frame.modes ??= [];
      if (block.some(mode => modes.some(other => other.index === mode.index))) throw new Error('Duplicate Psi4 vibration.');
      modes.push(...block);
      i = j + frame.atoms.length;
      continue;
    }
  }
  return history.document('psi4-log', orbitalFrame === history.frames.length - 1 ? orbitals : [], converged);
}

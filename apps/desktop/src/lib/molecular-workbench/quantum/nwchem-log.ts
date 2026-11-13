import { atomicNumber, elementSymbol } from '../elements';
import type { MolecularAtom, Vec3 } from '../types';
import type { MolecularOrbital, ScientificDocument, VibrationalMode } from '../scientific-types';
import { hessianFromLowerTriangle } from '../hessian';
import { BOHR, coordinate, numeric } from './reader-values';
import { DEBYE_PER_AU, OutputHistory, orbitalTable, outputLines } from './output-history';
import { readThermochemistryLine } from './thermochemistry';
import { readConvergence } from './convergence';
import { absorptionSpectrum, withFrameSpectra, type ExcitedState } from './excited-states';

const ELEMENT = /^([A-Za-z]{1,2})/u;
const SCF_ENERGY = /^\s*Total (?:SCF|DFT) energy\s*=\s*(\S+)/u;
// MP2, coupled-cluster and CI total energies of the same geometry (task energy order: last wins).
const CORRELATED_ENERGY = /^\s*(?:Total (?:MP2|MP3|MP4|CCSD|CCSD\(T\)|CISD) energy|(?:CCSD|CCSD\(T\)|CCSD\[T\]|CCSDT|CISD|MBPT\(2\)) total energy \/ (?:hartree|a\.u\.))\s*[:=]?\s*(-\d+\.\d+)\s*$/iu;
// Hessian fields are fixed-width Fortran D-format; NWChem 6 leaves no blank before a negative value
// (`-1.97223D-16-3.58723D-07`), so fields are read by their mandatory exponent, not by spaces.
const HESSIAN_ROW = /^\s*(\d+)((?:\s*[+-]?\d+\.\d+[DdEe][+-]?\d+)+)\s*$/u;
const HESSIAN_FIELD = /[+-]?\d+\.\d+[DdEe][+-]?\d+/gu;
// `Root   1 singlet bu   0.196071264 a.u.   5.3354 eV`; a run without symmetry prints `singlet a`.
const TDDFT_ROOT = /^\s*Root\s+(\d+)\s+(.*?)\s+-?\d+\.\d+ a\.u\.\s+(-?\d+\.\d+) eV\s*$/u;

function element(tag: string, charge: number) {
  if (/^bq/iu.test(tag)) throw new Error('NWChem ghost (bq) centres are not supported.');
  const match = tag.match(ELEMENT)?.[1];
  for (const candidate of match ? [match, match[0]] : []) {
    const symbol = candidate[0].toUpperCase() + candidate.slice(1).toLowerCase();
    try { atomicNumber(symbol); return symbol; } catch { /* try a one-letter symbol */ }
  }
  // Tags are free text; fall back to the printed nuclear charge only when it is an integer.
  if (Number.isInteger(charge) && charge >= 1) return elementSymbol(charge);
  throw new Error(`Unrecognised NWChem atom tag ${tag}.`);
}

/** Column blocks headed by 1-based numbers, then `label value value ...` rows. */
function columnBlocks(lines: string[], start: number, rows: number, valueLabel: RegExp) {
  const columns = new Map<number, { value: number; vector: number[] }>();
  let i = start;
  for (;;) {
    while (i < lines.length && !lines[i].trim()) i++;
    const header = lines[i]?.trim().split(/\s+/) ?? [];
    if (!header.length || !header.every(token => /^\d+$/.test(token))) break;
    const numbers = header.map(Number);
    while (++i < lines.length && !lines[i].trim()) { /* blank */ }
    if (i >= lines.length) return { columns, end: i, truncated: true };
    const label = lines[i].match(valueLabel);
    if (!label) throw new Error('Malformed NWChem normal-mode block.');
    const values = lines[i].slice(label[0].length).trim().split(/\s+/).map(numeric);
    if (values.length !== numbers.length) throw new Error('Malformed NWChem normal-mode block.');
    while (++i < lines.length && !lines[i].trim()) { /* blank */ }
    const vectors = numbers.map(() => [] as number[]);
    for (let row = 0; row < rows; row++, i++) {
      if (i >= lines.length) return { columns, end: i, truncated: true };
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length !== numbers.length + 1 || Number(parts[0]) !== row + 1) throw new Error('Truncated NWChem normal-mode vectors.');
      parts.slice(1).forEach((token, column) => vectors[column].push(numeric(token)));
    }
    numbers.forEach((number, column) => {
      if (columns.has(number)) throw new Error('Duplicate NWChem normal mode.');
      columns.set(number, { value: values[column], vector: vectors[column] });
    });
  }
  return { columns, end: i, truncated: i >= lines.length };
}

/**
 * NWChem 6–7 output (https://nwchemgit.github.io): geometry tables are angstrom or a.u. as
 * labelled; energies Hartree; eigenvalues Hartree; "NORMAL MODE EIGENVECTORS IN CARTESIAN
 * COORDINATES" are Cartesian (not mass-weighted) displacements in printed atom order; the
 * Hessian is printed mass-weighted in Hartree/bohr²/kamu. The projected analysis replaces the
 * unprojected one when both are printed.
 */
export function parseNwchemLog(text: string, name = 'output'): ScientificDocument {
  const lines = outputLines(text);
  const history = new OutputHistory();
  const masses = new Map<string, number>();
  type Vector = { energy: number; occupancy: number; symmetry?: string };
  let orbitals: { alpha?: number[]; beta?: number[] } = {};
  let vectors: Record<'alpha' | 'beta', Map<number, Vector>> = { alpha: new Map(), beta: new Map() };
  // Orbitals belong to the frame whose own SCF printed them; those of a line-search trial wait
  // for the geometry whose SCF repeats the trial energy.
  let orbitalFrame = -1, orbitalTrial: number | undefined;
  const resetOrbitals = () => {
    orbitals = {}; vectors = { alpha: new Map(), beta: new Map() };
    orbitalFrame = history.trial ? -1 : history.frames.length - 1;
    orbitalTrial = history.trialEnergy;
  };
  // Per-atom masses of the vibrational analysis (isotopes included), printed before its Hessian.
  let vibrationMasses: number[] | undefined;
  let electrons: { closed: number; open: number } | { alpha: number; beta: number } | undefined;
  let converged: boolean | undefined;
  let vectorSpin: 'alpha' | 'beta' = 'alpha';
  // One TDDFT run per table, numbered from root 1, at the geometry it was computed for.
  const excited: { frame: number; states: ExcitedState[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const units = line.match(/^\s*Output coordinates in (angstroms|a\.u\.)/u);
    if (units) {
      const scale = units[1] === 'a.u.' ? BOHR : 1;
      while (++i < lines.length && !/^\s*No\.\s+Tag\s+Charge\s+X\s+Y\s+Z/u.test(lines[i])) if (lines[i].trim()) throw new Error('Malformed NWChem geometry header.');
      if (!/^\s*-{4}/u.test(lines[++i] ?? '')) throw new Error('Malformed NWChem geometry header.');
      const atoms: MolecularAtom[] = [];
      while (++i < lines.length && lines[i].trim()) {
        const p = lines[i].trim().split(/\s+/);
        if (p.length !== 6 || Number(p[0]) !== atoms.length + 1) throw new Error('Malformed NWChem geometry row.');
        atoms.push(coordinate(element(p[1], numeric(p[2])), p.slice(3).map(numeric), scale));
      }
      if (i >= lines.length || !atoms.length) break; // A geometry cut off by the end of the file is not a frame.
      history.geometry(atoms);
      continue;
    }
    if (/^\s*Atomic Mass\s*$/u.test(line)) {
      i += 2;
      while (i < lines.length && !lines[i].trim()) i++;
      for (i--; ++i < lines.length && lines[i].trim();) {
        const p = lines[i].trim().split(/\s+/);
        if (p.length === 2) masses.set(p[0], numeric(p[1]));
      }
      continue;
    }
    if (readThermochemistryLine('nwchem', lines, i, history.frames.at(-1))) continue;
    const convergenceEnd = readConvergence('nwchem', lines, i, history.frames.at(-1));
    if (convergenceEnd >= 0) { i = convergenceEnd; continue; }
    let match = line.match(TDDFT_ROOT);
    if (match) {
      const number = Number(match[1]);
      if (number === 1 && history.frames.length) excited.push({ frame: history.frames.length - 1, states: [] });
      const table = excited.at(-1);
      if (!table || number !== table.states.length + 1) throw new Error('Out-of-order NWChem TDDFT roots.');
      const state: ExcitedState = { label: `${number} ${match[2]}`, energyEv: numeric(match[3]), oscillatorStrength: NaN };
      // Triplet roots print `Spin forbidden` instead of their moments and strength.
      for (let j = i + 1; j < lines.length && !TDDFT_ROOT.test(lines[j]) && !/^\s*Occ\.\s/u.test(lines[j]); j++) {
        const dipole = lines[j].match(/^\s*Transition Moments\s+X\s+(\S+)\s+Y\s+(\S+)\s+Z\s+(\S+)\s*$/u);
        if (dipole) state.transitionDipoleAu = [numeric(dipole[1]), numeric(dipole[2]), numeric(dipole[3])];
        if (/^\s*Transition Moments\s+Spin forbidden\s*$/u.test(lines[j])) state.oscillatorStrength = 0;
        const strength = lines[j].match(/^\s*(?:Dipole )?Oscillator Strength\s+(\S+)\s*$/u);
        if (strength) { state.oscillatorStrength = numeric(strength[1]); break; }
      }
      if (!Number.isFinite(state.oscillatorStrength)) throw new Error('NWChem TDDFT root has no oscillator strength.');
      table.states.push(state);
      continue;
    }
    match = line.match(SCF_ENERGY);
    if (match) {
      const adopted = history.scfEnergy(numeric(match[1]));
      if (adopted !== undefined && orbitalFrame === -1 && orbitalTrial === adopted) orbitalFrame = history.frames.length - 1;
      continue;
    }
    match = line.match(CORRELATED_ENERGY);
    if (match) { history.correlatedEnergy(numeric(match[1])); continue; }
    if (/^\s*Optimization converged\s*$/u.test(line)) converged = true;
    if (/Calculation failed to converge|Optimization failed|Failed to converge in maximum number of steps/u.test(line)) converged = false;
    // SCF headers print `closed shells`/`open shells` (RHF, ROHF) or `alpha electrons`/`beta electrons`
    // (UHF); the DFT header prints `Alpha electrons :`/`Beta electrons :`.
    match = line.match(/^\s*(closed shells|alpha electrons|Alpha electrons)\s*[=:]\s*(\d+)\s*$/u);
    const second = match && lines[i + 1]?.match(/^\s*(open shells|beta\s+electrons|Beta electrons)\s*[=:]\s*(\d+)\s*$/u);
    if (match && second) {
      electrons = match[1] === 'closed shells' ? { closed: Number(match[2]), open: Number(second[2]) } : { alpha: Number(match[2]), beta: Number(second[2]) };
      i++;
      continue;
    }
    match = line.match(/^\s*Final (alpha |beta )?eigenvalues\s*$/u);
    if (match) {
      const spin = match[1]?.trim() === 'beta' ? 'beta' : 'alpha';
      if (spin === 'alpha') resetOrbitals();
      i += 2;
      while (i < lines.length && !lines[i].trim()) i++;
      if (i >= lines.length) break;
      if (lines[i].trim() !== '1') throw new Error('Malformed NWChem eigenvalue table.');
      const values: number[] = [];
      while (++i < lines.length && lines[i].trim()) {
        const p = lines[i].trim().split(/\s+/);
        if (p.length !== 2 || Number(p[0]) !== values.length + 1) throw new Error('Malformed NWChem eigenvalue row.');
        values.push(numeric(p[1]));
      }
      if (i >= lines.length) break;
      orbitals[spin] = values;
      continue;
    }
    match = line.match(/(?:ROHF|RHF|UHF|DFT) Final (Alpha |Beta )?Molecular Orbital Analysis/u);
    if (match) {
      vectorSpin = match[1]?.trim() === 'Beta' ? 'beta' : 'alpha';
      if (/DFT/u.test(line) && vectorSpin === 'alpha') resetOrbitals();
      continue;
    }
    match = line.match(/^\s*Vector\s+(\d+)\s+Occ=(\S+)\s+E=\s*(\S+)(?:\s+Symmetry=(\S+))?\s*$/u);
    if (match) {
      vectors[vectorSpin].set(Number(match[1]), { occupancy: numeric(match[2]), energy: numeric(match[3]), ...(match[4] ? { symmetry: match[4] } : {}) });
      continue;
    }
    if (/^\s*Mulliken analysis of the total density\s*$/u.test(line)) {
      while (++i < lines.length && !/^\s*Atom\s+Charge\s+Shell Charges/u.test(lines[i])) if (i > 0 && /\d/u.test(lines[i])) throw new Error('Malformed NWChem Mulliken table.');
      i++;
      const charges: number[] = [];
      while (++i < lines.length && lines[i].trim()) {
        const p = lines[i].trim().split(/\s+/);
        if (p.length < 4 || Number(p[0]) !== charges.length + 1) throw new Error('Malformed NWChem Mulliken row.');
        charges.push(numeric(p[2]) - numeric(p[3]));
      }
      if (i >= lines.length) break;
      history.charges('mulliken', charges);
      continue;
    }
    if (/^\s*Multipole analysis of the density/u.test(line)) {
      const dipole: number[] = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 16) && dipole.length < 3; j++) {
        const p = lines[j].trim().split(/\s+/);
        if (p[0] === '1' && p.length >= 5) dipole[[p[1], p[2], p[3]].indexOf('1')] = numeric(p[4]) * DEBYE_PER_AU;
      }
      if (dipole.length === 3 && dipole.every(Number.isFinite)) history.dipole(dipole as Vec3);
      continue;
    }
    if (/^\s*-+ Atom information -+\s*$/u.test(line)) {
      const values: number[] = [];
      for (i += 3; i < lines.length && !/^\s*-+\s*$/u.test(lines[i]); i++) {
        const p = lines[i].trim().split(/\s+/);
        if (p.length !== 6 || Number(p[1]) !== values.length + 1) throw new Error('Malformed NWChem atom information row.');
        values.push(numeric(p[5]));
      }
      vibrationMasses = values;
      continue;
    }
    if (/^\s*MASS-WEIGHTED NUCLEAR HESSIAN \(Hartree\/Bohr\/Bohr\/Kamu\)/u.test(line)) {
      const frame = history.current('Hessian');
      const n = frame.atoms.length * 3;
      const atomMasses = vibrationMasses?.length === frame.atoms.length ? vibrationMasses : frame.atoms.map(atom => masses.get(atom.element));
      vibrationMasses = undefined;
      const triangle = new Array<number>(n * (n + 1) / 2);
      let filled = 0, columns: number[] = [];
      // Lower-triangle blocks of column numbers; each row lists the block's columns up to the diagonal.
      for (let j = i + 3; j < lines.length && filled < triangle.length; j++) {
        const p = lines[j].trim().split(/\s+/);
        if (!lines[j].trim() || /^-+$/u.test(p[0])) continue;
        if (p.every(token => /^\d+$/u.test(token))) { columns = p.map(token => Number(token) - 1); continue; }
        const fields = lines[j].match(HESSIAN_ROW);
        if (!fields) throw new Error('Malformed NWChem Hessian.');
        const row = Number(fields[1]) - 1, values = fields[2].match(HESSIAN_FIELD)!;
        if (!columns.length || row >= n || values.length !== Math.min(columns.length, row - columns[0] + 1)) throw new Error('Malformed NWChem Hessian.');
        values.forEach((token, k) => {
          const column = columns[k];
          const offset = row * (row + 1) / 2 + column;
          if (triangle[offset] !== undefined) throw new Error('Duplicate NWChem Hessian element.');
          filled++;
          // Hartree/bohr²/kamu → Hartree/bohr² with the printed masses (amu).
          triangle[offset] = numeric(token) * Math.sqrt(atomMasses[Math.floor(row / 3)]! * atomMasses[Math.floor(column / 3)]!) / 1000;
        });
        i = j;
      }
      if (filled === triangle.length && atomMasses.every(mass => mass !== undefined)) frame.hessian = { ...hessianFromLowerTriangle(triangle, frame.atoms.length, atomMasses as number[]), source: 'nwchem-log' };
      continue;
    }
    if (/^\s*NORMAL MODE EIGENVECTORS IN CARTESIAN COORDINATES/u.test(line)) {
      const frame = history.current('normal modes');
      const projected = /Projected/u.test(lines[i + 2] ?? '');
      const { columns, end, truncated } = columnBlocks(lines, i + 3, frame.atoms.length * 3, projected ? /^\s*P\.Frequency/u : /^\s*Frequency/u);
      if (truncated && columns.size !== frame.atoms.length * 3) break; // The file ends inside the table: keep any earlier analysis.
      if (columns.size !== frame.atoms.length * 3) throw new Error('NWChem normal-mode count does not match the atoms.');
      const modes: VibrationalMode[] = [...columns].map(([number, { value, vector }]) => ({ index: number - 1, frequencyCm1: value,
        displacements: frame.atoms.map((_, atom) => vector.slice(atom * 3, atom * 3 + 3) as Vec3) }));
      i = end - 1;
      for (let j = end; j < lines.length; j++) {
        if (/NORMAL MODE EIGENVECTORS|Vibrational analysis via/u.test(lines[j])) break;
        if (!/^\s*Normal Eigenvalue \|\|\s+(?:Projected )?Infra Red Intensities/u.test(lines[j])) continue;
        if (!/\[\(KM\/mol\)\]/u.test(lines[j + 1] ?? '')) throw new Error('Unsupported NWChem infrared table.');
        for (let k = j + 3, row = 0; row < modes.length; k++, row++) {
          if (k >= lines.length) { modes.forEach(mode => { delete mode.intensityKmMol; }); break; }
          const p = lines[k].trim().split(/\s+/);
          if (p.length !== 7 || p[2] !== '||' || Number(p[0]) !== row + 1 || Math.abs(numeric(p[1]) - modes[row].frequencyCm1) > 0.01) throw new Error('Malformed NWChem infrared row.');
          const intensity = numeric(p[5]);
          if (intensity < 0) throw new Error('Negative NWChem infrared intensity.');
          modes[row].intensityKmMol = intensity;
          modes[row].frequencyCm1 = numeric(p[1]); // printed to 0.001 cm^-1 here, 0.01 in the vector table

        }
        i = j;
        break;
      }
      frame.modes = modes;
    }
  }
  const restricted = !orbitals.beta && !vectors.beta.size;
  // Restricted occupations: doubly below the open shells, singly (alpha) within them.
  const occupancy = (spin: 'alpha' | 'beta', n: number) => {
    if (!electrons) return undefined;
    const [paired, total] = 'closed' in electrons ? [electrons.closed, electrons.closed + electrons.open]
      : [Math.min(electrons.alpha, electrons.beta), spin === 'alpha' ? electrons.alpha : electrons.beta];
    return restricted ? (n <= paired ? 2 : n <= Math.max(total, 'alpha' in electrons ? electrons.alpha : total) ? 1 : 0) : n <= total ? 1 : 0;
  };
  const table = (spin: 'alpha' | 'beta'): MolecularOrbital[] => {
    const energies = orbitals[spin], printed = vectors[spin];
    const rows: { energyHartree: number; occupancy: number; symmetry?: string }[] = [];
    for (let n = 1; n <= (energies?.length ?? printed.size); n++) {
      const vector = printed.get(n);
      if (!vector && !energies) throw new Error('NWChem printed a partial orbital window without its eigenvalues.');
      const occupied = vector?.occupancy ?? occupancy(spin, n);
      if (occupied === undefined) throw new Error('NWChem orbital occupations are not printed.');
      rows.push({ energyHartree: vector?.energy ?? energies![n - 1], occupancy: occupied, ...(vector?.symmetry ? { symmetry: vector.symmetry } : {}) });
    }
    return orbitalTable(spin, rows);
  };
  // DFT prints a vector window: keep orbitals only when they start at the first vector.
  const windowed = !orbitals.alpha && vectors.alpha.size > 0 && !vectors.alpha.has(1);
  const all = orbitalFrame !== history.frames.length - 1 || windowed ? [] : [...table('alpha'), ...(restricted ? [] : table('beta'))];
  return withFrameSpectra(history.document('nwchem-log', all, converged), name, excited.map(({ frame, states }) => ({ frame, spectrum: absorptionSpectrum(states) })));
}

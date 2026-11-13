import { atomicNumber } from '../elements';
import type { MolecularAtom, Vec3 } from '../types';
import type { MolecularOrbital, OptimizationConvergence, ScientificDocument } from '../scientific-types';
import { BOHR, coordinate, MAX_ATOMS, numeric } from './reader-values';
import { DEBYE_PER_AU, OutputHistory, outputLines } from './output-history';
import { readThermochemistryLine } from './thermochemistry';
import { xtbMetadata } from './run-metadata';


function symbol(token: string) {
  const element = token[0].toUpperCase() + token.slice(1).toLowerCase();
  atomicNumber(element);
  return element;
}

function xyzBlock(lines: string[], start: number) {
  const count = Number(lines[start]?.trim());
  if (!Number.isInteger(count) || count < 1 || count > MAX_ATOMS) throw new Error('Malformed xtb XYZ block.');
  if (start + 1 + count >= lines.length) return null;
  const atoms: MolecularAtom[] = [];
  for (let k = 0; k < count; k++) {
    const p = lines[start + 2 + k].trim().split(/\s+/);
    if (p.length !== 4 && start + 2 + k === lines.length - 1) return null; // cut while being written
    if (p.length !== 4) throw new Error('Malformed xtb XYZ row.');
    atoms.push(coordinate(symbol(p[0]), p.slice(1).map(numeric)));
  }
  return { atoms, comment: lines[start + 1], end: start + 2 + count };
}

/**
 * xtb 6 standard output (https://xtb-docs.readthedocs.io): the `final structure` block (XYZ in
 * angstrom or Turbomole `$coord` in bohr) is the only geometry it prints, so properties of the
 * unprinted input geometry before it are not attached to anything. Energies are Hartree;
 * the orbital table is the printed window (source numbering kept, virtual occupation blank);
 * charges are the printed `q` column (GFN-xTB Mulliken, GFN-FF EEQ); dipole components are a.u.
 */
export function parseXtbOutput(text: string): ScientificDocument {
  const lines = outputLines(text);
  const history = new OutputHistory();
  const forceField = /^\s*\|\s+G F N - F F\s+\|\s*$/mu.test(text);
  let orbitals: MolecularOrbital[] = [];
  let converged: boolean | undefined;
  // The optimizer's thresholds and its last cycle, which judged the geometry it then prints as final.
  const thresholds: { energyChange?: number; gradientNorm?: number } = {};
  let cycle: { energy: number; change: number; gradientNorm?: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const setup = line.match(/^\s*:\s*(energy|grad\.) convergence\s+(\S+)\s+Eh/u);
    if (setup) { thresholds[setup[1] === 'energy' ? 'energyChange' : 'gradientNorm'] = numeric(setup[2]); continue; }
    const total = line.match(/^\s*\* total energy\s*:\s*(\S+)\s+Eh\s+change\s+(\S+)\s+Eh\s*$/u);
    if (total) { cycle = { energy: numeric(total[1]), change: numeric(total[2]) }; continue; }
    const norm = line.match(/^\s*gradient norm\s*:\s*(\S+)\s+Eh\/\S+\s/u);
    if (norm && cycle) { cycle.gradientNorm = numeric(norm[1]); continue; }
    if (/^\s*final structure:\s*$/u.test(line)) {
      let j = i + 1;
      while (j < lines.length && /^\s*=*\s*$/u.test(lines[j])) j++;
      if (/^\s*\$coord/u.test(lines[j] ?? '')) {
        const atoms: MolecularAtom[] = [];
        const scale = /angs/u.test(lines[j]) ? 1 : BOHR;
        for (j++; j < lines.length && !/^\s*\$/u.test(lines[j]); j++) {
          const p = lines[j].trim().split(/\s+/);
          if (p.length !== 4) throw new Error('Malformed xtb $coord row.');
          atoms.push(coordinate(symbol(p[3]), p.slice(0, 3).map(numeric), scale));
        }
        if (j >= lines.length) break;
        history.geometry(atoms);
      } else {
        const block = xyzBlock(lines, j);
        if (!block) break;
        history.geometry(block.atoms);
        j = block.end;
      }
      orbitals = [];
      i = j - 1;
      continue;
    }
    if (/GEOMETRY OPTIMIZATION CONVERGED/u.test(line)) converged = true;
    if (/FAILED TO CONVERGE GEOMETRY OPTIMIZATION|convergence criteria cannot be satisfied/u.test(line)) converged = false;
    if (!history.frames.length) continue;
    if (readThermochemistryLine('xtb', lines, i, history.frames.at(-1))) continue;
    const energy = line.match(/^\s*\|\s*TOTAL ENERGY\s+(\S+)\s+Eh\s*\|\s*$/u);
    if (energy) { history.scfEnergy(numeric(energy[1])); continue; }
    if (/^\s*\* Orbital Energies and Occupations\s*$/u.test(line)) {
      const rows: MolecularOrbital[] = [];
      let j = i + 1;
      while (j < lines.length && !/^\s*-{20,}\s*$/u.test(lines[j])) j++;
      for (j++; j < lines.length && !/^\s*-{20,}\s*$/u.test(lines[j]); j++) {
        if (/^\s*\.\.\./u.test(lines[j])) continue; // orbitals outside the printed window
        const row = lines[j].match(/^\s*(\d+)\s+(?:(\d+\.\d+)\s+)?(-?\d+\.\d+)\s+(-?\d+\.\d+)(?:\s+\((?:HOMO|LUMO)\))?\s*$/u);
        if (!row) throw new Error('Malformed xtb orbital row.');
        const occupancy = row[2] === undefined ? 0 : numeric(row[2]);
        if (occupancy < 0 || occupancy > 2) throw new Error('Invalid xtb orbital occupation.');
        rows.push({ index: Number(row[1]) - 1, spin: 'alpha', occupancy, energyHartree: numeric(row[3]), coefficients: [] });
      }
      if (j >= lines.length) break;
      if (rows.length > 10_000 || rows.some((row, k) => k > 0 && row.index <= rows[k - 1].index)) throw new Error('Invalid xtb orbital numbering.');
      orbitals = rows;
      i = j;
      continue;
    }
    if (/^\s*#\s+Z\s+covCN\s+q\s+C6AA/u.test(line)) {
      const charges: number[] = [];
      for (i++; i < lines.length && /^\s*\d+\s+\d+\s+[A-Za-z]{1,2}\s/u.test(lines[i]); i++) {
        const p = lines[i].trim().split(/\s+/);
        if (Number(p[0]) !== charges.length + 1) throw new Error('Malformed xtb charge row.');
        charges.push(numeric(p[4]));
      }
      if (i >= lines.length) break;
      history.charges(forceField ? 'eeq' : 'mulliken', charges);
      continue;
    }
    if (/^\s*molecular dipole:\s*$/u.test(line)) {
      const full = lines.slice(i + 1, i + 4).map(row => row.match(/^\s*full:\s+(\S+)\s+(\S+)\s+(\S+)\s+\S+\s*$/u)).find(Boolean);
      if (full) history.dipole(full.slice(1, 4).map(value => numeric(value!) * DEBYE_PER_AU) as Vec3);
    }
  }
  if (!history.frames.length) throw new Error('This xtb output prints no geometry. Open the input coordinates instead, or the xtbopt.xyz, xtbopt.log or g98.out file written next to it.');
  const final = history.frames.at(-1)!;
  // The cycle prints its energy to 1e-7 Eh; another geometry's cycle is not this frame's.
  if (cycle && final.energyHartree !== undefined && Math.abs(cycle.energy - final.energyHartree) < 1e-6) {
    const step: OptimizationConvergence = {};
    if (cycle.change !== 0) step.energyChange = { value: Math.abs(cycle.change), ...(thresholds.energyChange ? { threshold: thresholds.energyChange } : {}) };
    if (cycle.gradientNorm !== undefined) step.gradientNorm = { value: cycle.gradientNorm, ...(thresholds.gradientNorm ? { threshold: thresholds.gradientNorm } : {}) };
    if (Object.keys(step).length) final.convergence = step;
  }
  const document = history.document('xtb', orbitals, converged);
  const metadata = xtbMetadata(lines, forceField);
  return metadata ? { ...document, metadata } : document;
}

/** The optimization trajectory xtb writes to `xtbopt.log`: angstrom XYZ frames with energies in Hartree. */
export function parseXtbTrajectory(text: string): ScientificDocument {
  const lines = outputLines(text);
  const history = new OutputHistory();
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue; }
    const block = xyzBlock(lines, i);
    if (!block) break; // the optimizer was stopped while writing this frame
    const energy = block.comment.match(/^\s*energy:\s+(\S+)\s+gnorm:\s+(\S+)\s+xtb:\s/u);
    if (!energy) throw new Error('xtb trajectory frames must carry their energy comment.');
    const first = history.frames[0];
    if (first && (block.atoms.length !== first.atoms.length || block.atoms.some((atom, a) => atom.element !== first.atoms[a].element))) throw new Error('xtb trajectory atom identity changes between frames.');
    if (history.frames.length >= 2000) throw new Error('xtb trajectory exceeds 2000 frames.');
    // Every written frame is its own optimizer step, even when two coincide.
    history.frames.push({ atoms: block.atoms, energyHartree: numeric(energy[1]), convergence: { gradientNorm: { value: numeric(energy[2]) } } });
    i = block.end;
  }
  return history.document('xtb', [], undefined);
}

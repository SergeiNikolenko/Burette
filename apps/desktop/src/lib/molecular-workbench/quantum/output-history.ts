import type { MolecularAtom, Vec3 } from '../types';
import type { AtomicChargeSet, MolecularOrbital, ScientificDocument, ScientificFrame } from '../scientific-types';
import { checkIdentity, finite, MAX_FRAMES, MAX_VALUES } from './reader-values';

/** 1 e·bohr in debye (CODATA 2018, as printed by Psi4 and NWChem). */
export const DEBYE_PER_AU = 2.541746473;
const SAME_POSITION_ANGSTROM = 1e-6;
/** Programs print SCF totals to 10–12 decimals; only a recomputation of the same geometry repeats one. */
const SAME_ENERGY_HARTREE = 1e-10;

/**
 * The geometry history of a text log. A program reprints the geometry it is about to
 * compute (input echo, optimizer step, frequency job); a reprint of the last geometry is
 * that same frame, so frame energies, modes and charges stay attached to their geometry.
 * The first SCF energy printed after a geometry is its energy: later SCF energies before
 * the next geometry belong to unprinted line-search trials, and so do the charges, dipole and
 * orbitals printed after them. A trial can be the next geometry itself (NWChem prints the
 * accepted step after the line search computed it): when that geometry's first SCF energy
 * repeats the trial energy, the trial's charges and dipole become its own. A correlated total
 * energy of the same geometry supersedes its SCF energy, and the last correlated level printed wins.
 */
export class OutputHistory {
  readonly frames: ScientificFrame[] = [];
  private levels: number[] = [];
  private values = 0;
  private pending: { energy: number; charges: AtomicChargeSet[]; dipole?: Vec3 } | undefined;
  /** Whether the properties now printed belong to an unprinted trial geometry. */
  trial = false;

  /** The SCF energy of the trial whose properties are now printed. */
  get trialEnergy() { return this.trial ? this.pending?.energy : undefined; }

  geometry(atoms: MolecularAtom[]) {
    const last = this.frames.at(-1);
    this.trial = false;
    if (last && sameGeometry(atoms, last)) {
      // A recomputation of the same geometry refreshes its SCF result.
      if (this.levels[this.frames.length - 1] === 1) this.levels[this.frames.length - 1] = 0;
      return last;
    }
    if (this.frames.length) checkIdentity(atoms, this.frames[0].atoms);
    this.values += atoms.length * 3;
    if (this.frames.length >= MAX_FRAMES || this.values > MAX_VALUES) throw new Error('Quantum output geometry history exceeds the browser limit.');
    const frame: ScientificFrame = { atoms };
    this.frames.push(frame);
    this.levels.push(0);
    return frame;
  }

  current(what: string) {
    const frame = this.frames.at(-1);
    if (!frame) throw new Error(`Quantum output ${what} has no preceding geometry.`);
    return frame;
  }

  /** Returns the trial energy when this geometry's SCF repeats it and adopted the trial's properties. */
  scfEnergy(value: number): number | undefined {
    const frame = this.current('energy');
    const level = this.levels[this.frames.length - 1];
    this.trial = level === 1;
    if (level === 1) { this.pending = { energy: finite(value), charges: [] }; return undefined; }
    if (level === 2) { this.trial = false; return undefined; }
    frame.energyHartree = finite(value);
    this.levels[this.frames.length - 1] = 1;
    const pending = this.pending;
    this.pending = undefined;
    if (!pending || Math.abs(pending.energy - value) > SAME_ENERGY_HARTREE) return undefined;
    for (const set of pending.charges) this.charges(set.model, set.values);
    if (pending.dipole) frame.dipoleDebye = pending.dipole;
    return pending.energy;
  }

  correlatedEnergy(value: number) {
    this.current('energy').energyHartree = finite(value);
    this.levels[this.frames.length - 1] = 2;
  }

  charges(model: AtomicChargeSet['model'], values: number[]) {
    const frame = this.current('charges');
    if (this.trial) {
      if (this.pending) this.pending.charges = [...this.pending.charges.filter(set => set.model !== model), { model, values }];
      return;
    }
    if (values.length !== frame.atoms.length || values.some(value => !Number.isFinite(value) || Math.abs(value) > 200)) throw new Error('Quantum output charges do not match the atoms.');
    // A later analysis of the same geometry (for example after a frequency job) replaces it.
    frame.charges = [...(frame.charges ?? []).filter(set => set.model !== model), { model, values }];
  }

  dipole(vector: Vec3) {
    if (vector.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) throw new Error('Quantum output dipole is not finite.');
    const frame = this.current('dipole');
    if (!this.trial) frame.dipoleDebye = vector;
    else if (this.pending) this.pending.dipole = vector;
  }

  /** The reference geometry is the last one printed; only it carries file-level orbitals and modes. */
  document(format: ScientificDocument['format'], orbitals: MolecularOrbital[], converged: boolean | undefined, extra: Partial<ScientificDocument> = {}): ScientificDocument {
    if (!this.frames.length) throw new Error('No supported geometry was found in the quantum output.');
    const last = this.frames.at(-1)!;
    return { format, atoms: last.atoms, referenceFrameIndex: this.frames.length - 1, frames: this.frames, modes: last.modes ?? [], orbitals,
      ...(converged === undefined ? {} : { converged }), ...extra };
  }
}

/** Whether a printed geometry reprints a frame (same elements, positions within 1e-6 Å). */
export function sameGeometry(atoms: readonly MolecularAtom[], frame: ScientificFrame) {
  return atoms.length === frame.atoms.length && atoms.every((atom, i) => atom.element === frame.atoms[i].element
    && Math.abs(atom.x - frame.atoms[i].x) <= SAME_POSITION_ANGSTROM && Math.abs(atom.y - frame.atoms[i].y) <= SAME_POSITION_ANGSTROM
    && Math.abs(atom.z - frame.atoms[i].z) <= SAME_POSITION_ANGSTROM);
}

/** Orbitals in energy order of one spin, numbered from zero in that order. */
export function orbitalTable(spin: MolecularOrbital['spin'], rows: { energyHartree: number; occupancy: number; symmetry?: string }[]): MolecularOrbital[] {
  if (rows.length > 10_000) throw new Error('Quantum output orbital table exceeds 10,000 orbitals.');
  return rows.map((row, index) => {
    if (!Number.isFinite(row.energyHartree) || !(row.occupancy >= 0 && row.occupancy <= 2)) throw new Error('Invalid quantum output orbital.');
    return { index, spin, energyHartree: row.energyHartree, occupancy: row.occupancy, ...(row.symmetry ? { symmetry: row.symmetry } : {}), coefficients: [] };
  });
}

/** Text lines without carriage returns or a byte-order mark. */
export function outputLines(text: string) {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
}

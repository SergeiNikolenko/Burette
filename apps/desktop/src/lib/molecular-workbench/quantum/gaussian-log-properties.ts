import type { Vec3 } from '../types';
import type { AdditionalSpectrum } from '../scientific-spectra';
import type { ScientificFrame } from '../scientific-types';
import { absorptionSpectrum, type ExcitedState } from './excited-states';
import { BOHR, numeric } from './reader-values';

const HARTREE_KCAL_MOL = 627.5094740631;
const EXCITED_STATE = /^\s*Excited State\s+(\d+):\s+(\S+)\s+(-?\d+\.\d+) eV\s+-?\d+\.\d+ nm\s+f=\s*(-?\d+\.\d+)/u;
const STATE_ROW = /^\s*(\d+)((?:\s+-?\d+\.\d+)+)\s*$/u;
const SHIELDING_ROW = /^\s*(\d+)\s+([A-Z][a-z]?)\s+Isotropic =\s*(\S+)\s+Anisotropy =\s*(\S+)\s*$/u;
const ROTATORY_UNIT = '10**-40 erg-esu-cm/Gauss';

export type GaussianFrameSpectrum = { frame: ScientificFrame; spectrum: AdditionalSpectrum };

/**
 * Properties of a Gaussian log that the geometry loop does not read: excited states (TD-DFT,
 * CIS and EOM print the same `Excited State` lines, after their transition dipole and rotatory
 * strength tables), GIAO shieldings, `S**2 before annihilation` and the Cartesian forces. Each
 * belongs to the geometry printed before it; spectra are collected with that frame.
 */
export class GaussianPropertyReader {
  readonly spectra: GaussianFrameSpectrum[] = [];
  private states: ExcitedState[] = [];
  private owner: ScientificFrame | undefined;
  private dipoles = new Map<number, Vec3>();
  private rotatory = new Map<number, number>();

  /** Reads the property starting at line `i`; returns the last line it used, or -1. */
  read(lines: readonly string[], i: number, frame: ScientificFrame): number {
    const line = lines[i];
    if (/^\s*Ground to excited state transition electric dipole moments \(Au\):\s*$/u.test(line)) {
      this.flush();
      return this.table(lines, i + 2, 4, (state, values) => this.dipoles.set(state, [values[0], values[1], values[2]]));
    }
    if (/^\s*Rotatory Strengths \(R\) in cgs \(10\*\*-40 erg-esu-cm\/Gauss\)\s*$/u.test(line) && /\bR\(velocity\)/u.test(lines[i + 1] ?? '')) {
      // The velocity form does not depend on the origin; the length form follows in its own table.
      // EOM-CC leaves out the E-M angle column.
      return this.table(lines, i + 2, 4, (state, values) => this.rotatory.set(state, values[3]));
    }
    let match = line.match(EXCITED_STATE);
    if (match) {
      const number = Number(match[1]);
      if (number !== this.states.length + 1) { this.flush(); if (number !== 1) throw new Error('Out-of-order Gaussian excited states.'); }
      this.owner ??= frame;
      this.states.push({ label: `${number} ${match[2]}`, energyEv: numeric(match[3]), oscillatorStrength: numeric(match[4]),
        ...(this.dipoles.has(number) ? { transitionDipoleAu: this.dipoles.get(number) } : {}) });
      return i;
    }
    if (/^\s*SCF GIAO Magnetic shielding tensor \(ppm\):\s*$/u.test(line)) return this.shieldings(lines, i + 1, frame);
    match = line.match(/^\s*S\*\*2 before annihilation\s+(\S+?),/u);
    if (match) { frame.spinSquared = numeric(match[1]); return i; }
    if (/^\s*Center\s+Atomic\s+Forces \(Hartrees\/Bohr\)\s*$/u.test(line)) return this.forces(lines, i, frame);
    return -1;
  }

  /** The spectra of the last excited-state block; call once after the last line. */
  finish() {
    this.flush();
    return this.spectra;
  }

  private flush() {
    if (this.states.length && this.owner) {
      const states = this.states.every(state => state.transitionDipoleAu) ? this.states : this.states.map(({ transitionDipoleAu: _, ...state }) => state);
      this.spectra.push({ frame: this.owner, spectrum: absorptionSpectrum(states) });
      const strengths = this.states.map((_, k) => this.rotatory.get(k + 1));
      // An achiral molecule prints a table of zeros, which is no spectrum.
      if (strengths.every(value => value !== undefined) && strengths.some(value => value !== 0)) {
        this.spectra.push({ frame: this.owner, spectrum: { kind: 'ecd', xUnit: 'eV', positions: this.states.map(state => state.energyEv),
          values: strengths as number[], valueUnit: ROTATORY_UNIT, sourceRowIds: this.states.map(state => state.label) } });
      }
    }
    this.states = [];
    this.owner = undefined;
    this.dipoles = new Map();
    this.rotatory = new Map();
  }

  /** Rows of `state` followed by at least `columns` numbers, numbered from 1. */
  private table(lines: readonly string[], start: number, columns: number, row: (state: number, values: number[]) => void) {
    let j = start;
    for (; j < lines.length; j++) {
      const match = lines[j].match(STATE_ROW);
      if (!match) break;
      const values = match[2].trim().split(/\s+/u).map(numeric);
      if (values.length < columns) throw new Error('Malformed Gaussian excited-state table row.');
      row(Number(match[1]), values);
    }
    return j - 1;
  }

  private shieldings(lines: readonly string[], start: number, frame: ScientificFrame) {
    const atomIndices: number[] = [], valuesPpm: number[] = [], anisotropy: number[] = [];
    let j = start;
    for (; j < lines.length; j++) {
      const match = lines[j].match(SHIELDING_ROW);
      if (!match) {
        if (/^\s*(?:[XYZ]{2}=|Eigenvalues:)/u.test(lines[j])) continue;
        break;
      }
      const atom = Number(match[1]) - 1;
      if (frame.atoms[atom]?.element !== match[2] || atom !== atomIndices.length) throw new Error('Gaussian shielding rows do not match the atoms.');
      atomIndices.push(atom);
      valuesPpm.push(numeric(match[3]));
      anisotropy.push(numeric(match[4]));
    }
    if (atomIndices.length !== frame.atoms.length) throw new Error('Gaussian shielding table does not cover the atoms.');
    this.spectra.push({ frame, spectrum: { kind: 'nmr', quantity: 'isotropic-shielding', atomIndices, valuesPpm,
      auxiliary: [{ name: 'source nucleus index', unit: null, values: atomIndices.map(atom => atom + 1) }, { name: 'anisotropy', unit: 'ppm', values: anisotropy }] } });
    return j - 1;
  }

  /** `Forces (Hartrees/Bohr)` are minus the gradient; frames keep them in kcal/(mol·Å). */
  private forces(lines: readonly string[], i: number, frame: ScientificFrame) {
    if (!/^\s*Number\s+Number\s+X\s+Y\s+Z\s*$/u.test(lines[i + 1] ?? '') || !/^\s*-{5,}\s*$/u.test(lines[i + 2] ?? '')) throw new Error('Malformed Gaussian forces header.');
    const forces: Vec3[] = [];
    let j = i + 3;
    for (; j < lines.length && !/^\s*-{5,}\s*$/u.test(lines[j]); j++) {
      const p = lines[j].trim().split(/\s+/u);
      if (p.length !== 5 || Number(p[0]) !== forces.length + 1) throw new Error('Malformed Gaussian forces row.');
      forces.push(p.slice(2).map(value => numeric(value) * HARTREE_KCAL_MOL / BOHR) as Vec3);
    }
    if (forces.length !== frame.atoms.length) throw new Error('Gaussian forces do not match the atoms.');
    frame.forcesKcalMolAngstrom = forces;
    return j;
  }
}

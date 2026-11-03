import { elementSymbol } from '../elements';
import type { MolecularAtom, Vec3 } from '../types';
import type { MolecularOrbital, ScientificDocument, VibrationalMode } from '../scientific-types';
import { hessianFromLowerTriangle, hessianFromSquare } from '../hessian';
import { BOHR, coordinate, numeric } from './reader-values';
import { OutputHistory, orbitalTable, outputLines } from './output-history';

const SCF_ENERGY = /^\s*!(?:RHF|UHF|ROHF|RKS|UKS|HF|KS)(?:-SCF)? STATE\s+\d+\.\d+\s+Energy\s+(-\d+\.\d+)\s*$/u;
// `!MP2 total energy`, `!CCSD(T) total energy`, `!RHF-UCCSD(T) energy` and similar result lines.
const CORRELATED_ENERGY = /^\s*!(?:[A-Z0-9-]*?(?:MP\d|CC\w*|CI\w*|QCI\w*)(?:\(T\)|\[T\])?)\s+(?:total\s+)?energy\s+(-\d+\.\d+)\s*$/u;
const COORDINATE_LABEL = /^([A-Z][a-z]?)([XYZ])(\d+)$/u;

/** `NR ATOM CHARGE X Y Z` rows in bohr; the nuclear charge identifies the element (Z-matrix dummies are not listed). */
function atomicCoordinates(lines: string[], start: number) {
  let i = start;
  while (i < lines.length && !lines[i].trim()) i++;
  const atoms: MolecularAtom[] = [];
  for (; i < lines.length && lines[i].trim(); i++) {
    const p = lines[i].trim().split(/\s+/);
    if (p.length !== 6 || Number(p[0]) !== atoms.length + 1) throw new Error('Malformed Molpro coordinate row.');
    const charge = numeric(p[2]);
    if (!Number.isInteger(charge) || charge < 1) throw new Error('Molpro ghost or dummy centres are not supported.');
    atoms.push(coordinate(elementSymbol(charge), p.slice(3).map(numeric), BOHR));
  }
  return { atoms, end: i, complete: i < lines.length && atoms.length > 0 };
}

/** Lower-triangle blocks headed by coordinate labels (`CX1 CY1 ...`); returns rows × columns values. */
function labelledTriangle(lines: string[], start: number, dimension: number) {
  const triangle = new Array<number | undefined>(dimension * (dimension + 1) / 2);
  let columns: number[] = [], filled = 0, i = start;
  const index = (label: string) => {
    const match = label.match(COORDINATE_LABEL);
    if (!match) return -1;
    return (Number(match[3]) - 1) * 3 + 'XYZ'.indexOf(match[2]);
  };
  for (; i < lines.length && filled < triangle.length; i++) {
    const p = lines[i].trim().split(/\s+/);
    if (!lines[i].trim()) continue;
    if (p.every(token => COORDINATE_LABEL.test(token))) { columns = p.map(index); continue; }
    const row = index(p[0]);
    if (row < 0 || !columns.length) break;
    const values = p.slice(1).map(numeric);
    if (row >= dimension || values.length !== Math.min(columns.length, row - columns[0] + 1)) throw new Error('Malformed Molpro second-derivative matrix.');
    values.forEach((value, k) => {
      const offset = row * (row + 1) / 2 + columns[k];
      if (triangle[offset] !== undefined) throw new Error('Duplicate Molpro second-derivative element.');
      triangle[offset] = value;
      filled++;
    });
  }
  return { triangle: filled === triangle.length ? triangle as number[] : undefined, end: i };
}

/**
 * Molpro 2006–2022 output (https://www.molpro.net/manual): `ATOMIC COORDINATES` in bohr; the
 * optimizer's final `Current geometry` in angstrom (intermediate optimizer steps are not printed in
 * the output, only in the `.log`); `!... STATE n.m Energy` and `!... total energy` in Hartree;
 * dipoles in debye; the mass-weighted second-derivative matrix in Hartree/(bohr²·amu); normal modes as
 * printed Cartesian vectors, IR in km/mol. Orbital coefficients are listed over symmetry-adapted
 * basis functions: `put,molden` writes them as an ordinary Molden file.
 */
export function parseMolproLog(text: string): ScientificDocument {
  const lines = outputLines(text);
  const history = new OutputHistory();
  let converged: boolean | undefined;
  let masses: number[] | undefined;
  type Orbital = { energyHartree: number; occupancy: number };
  let orbitals: { frame: number; alpha?: Orbital[]; beta?: Orbital[] } = { frame: -1 };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*ATOMIC COORDINATES\s*$/u.test(line)) {
      if (!/^\s*NR\s+ATOM\s+CHARGE\s+X\s+Y\s+Z\s*$/u.test(lines[i + 2] ?? '')) break;
      const { atoms, end, complete } = atomicCoordinates(lines, i + 3);
      if (!complete) break;
      history.geometry(atoms);
      i = end;
      continue;
    }
    if (/^\s*Current geometry \(xyz format, in Angstrom\)\s*$/u.test(line)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const count = Number(lines[j]?.trim());
      if (!Number.isInteger(count) || count < 1 || j + 1 + count >= lines.length) break;
      const atoms = lines.slice(j + 2, j + 2 + count).map(row => {
        const p = row.trim().split(/\s+/);
        if (p.length !== 4) throw new Error('Malformed Molpro geometry row.');
        return coordinate(p[0][0].toUpperCase() + p[0].slice(1).toLowerCase(), p.slice(1).map(numeric));
      });
      history.geometry(atoms);
      i = j + 1 + count;
      continue;
    }
    let match = line.match(SCF_ENERGY);
    if (match) { history.scfEnergy(numeric(match[1])); continue; }
    match = line.match(CORRELATED_ENERGY);
    if (match) { history.correlatedEnergy(numeric(match[1])); continue; }
    if (/^\s*END OF GEOMETRY OPTIMIZATION\.\s*$/u.test(line)) converged = true;
    if (/^\s*\?\s*No convergence|^\s*\?\s*Error/u.test(line)) converged = false;
    match = line.match(/^\s*Dipole moment \/Debye\s+(\S+)\s+(\S+)\s+(\S+)\s*$/u);
    if (match) { history.dipole([numeric(match[1]), numeric(match[2]), numeric(match[3])]); continue; }
    match = line.match(/^\s*ELECTRON ORBITALS(?: FOR (POSITIVE|NEGATIVE) SPIN)?\s*$/u);
    if (match) {
      const rows: Orbital[] = [];
      let j = i + 1;
      for (; j < lines.length && !/^\s*(?:HOMO|LUMO|\*{20,}|ELECTRON ORBITALS|NATURAL|Population analysis)/u.test(lines[j]); j++) {
        // Spin-orbital tables mark an occupied orbital with + or - (its spin) instead of a number.
        const row = lines[j].match(/^\s*\d+\.[1-8]\s+(\d+(?:\.\d+)?|[+-])\s+(-?\d+\.\d+)(?:\s|$)/u);
        if (row) rows.push({ occupancy: /^[+-]$/u.test(row[1]) ? 1 : numeric(row[1]), energyHartree: numeric(row[2]) });
      }
      if (j >= lines.length) break;
      i = j - 1;
      if (history.trial) continue;
      const frame = history.frames.length - 1;
      // Symmetry blocks interleave; the table numbers orbitals in energy order.
      rows.sort((a, b) => a.energyHartree - b.energyHartree);
      if (match[1] === 'NEGATIVE') { if (orbitals.frame === frame) orbitals.beta = rows; }
      else orbitals = { frame, alpha: rows };
      continue;
    }
    if (/^\s*Population analysis by basis function type\s*$/u.test(line)) {
      const frame = history.current('charges');
      let j = i + 1;
      while (j < lines.length && !/^\s*Unique atom/u.test(lines[j])) j++;
      const charges: number[] = [];
      for (j++; j < lines.length && lines[j].trim(); j++) {
        const charge = lines[j].match(/^\s*\d+\s+([A-Za-z]{1,2})\S*\s+.*\s([-+])\s*(\d+\.\d+)\s*$/u);
        if (!charge || charges.length >= frame.atoms.length || charge[1].toLowerCase() !== frame.atoms[charges.length].element.toLowerCase()) throw new Error('Malformed Molpro population row.');
        charges.push((charge[2] === '-' ? -1 : 1) * numeric(charge[3]));
      }
      if (j >= lines.length) break;
      if (charges.length === frame.atoms.length) history.charges('mulliken', charges);
      i = j;
      continue;
    }
    if (/^\s*Force Constants \(Second Derivatives of the Energy\) in \[a\.u\.\]\s*$/u.test(line)) {
      const frame = history.current('Hessian');
      const { triangle, end } = labelledTriangle(lines, i + 1, frame.atoms.length * 3);
      if (!triangle) { if (end >= lines.length) break; throw new Error('Incomplete Molpro force-constant matrix.'); }
      frame.hessian = { ...hessianFromLowerTriangle(triangle, frame.atoms.length), source: 'molpro-log' };
      i = end - 1;
      continue;
    }
    if (/^\s*Atomic Masses\s*$/u.test(line)) {
      const frame = history.current('masses');
      const values: number[] = [];
      let j = i + 1;
      for (; j < lines.length && /^\s*\d+-\s*\d+\s/u.test(lines[j]); j++) values.push(...lines[j].replace(/^\s*\d+-\s*\d+/u, '').trim().split(/\s+/).map(numeric));
      if (values.length !== frame.atoms.length) throw new Error('Molpro atomic masses do not match the atoms.');
      masses = values;
      if (frame.hessian && !frame.hessian.massesAmu) frame.hessian = { ...hessianFromSquare(frame.hessian.values, frame.atoms.length, 'molpro-log', values) };
      i = j - 1;
      continue;
    }
    // Printed after the force constants it is derived from; read only when they are absent.
    if (/^\s*Mass weighted Second Derivative Matrix\s*$/u.test(line) && !history.current('Hessian').hessian) {
      const frame = history.current('Hessian');
      const n = frame.atoms.length * 3;
      const { triangle, end } = labelledTriangle(lines, i + 1, n);
      if (!triangle) { if (end >= lines.length) break; throw new Error('Incomplete Molpro second-derivative matrix.'); }
      if (masses?.length !== frame.atoms.length) throw new Error('Molpro second derivatives have no matching atomic masses.');
      const m = masses;
      let offset = 0;
      for (let row = 0; row < n; row++) for (let column = 0; column <= row; column++) triangle[offset++] *= Math.sqrt(m[Math.floor(row / 3)] * m[Math.floor(column / 3)]);
      frame.hessian = { ...hessianFromLowerTriangle(triangle, frame.atoms.length, m), source: 'molpro-log' };
      i = end - 1;
      continue;
    }
    if (/^\s*Normal Modes\s*$/u.test(line)) {
      const frame = history.current('normal modes');
      const n = frame.atoms.length * 3;
      const modes: VibrationalMode[] = [];
      let j = i + 1;
      for (;;) {
        while (j < lines.length && !lines[j].trim()) j++;
        const header = lines[j]?.trim().split(/\s+/) ?? [];
        if (!header.length || header.length % 2 || !header.every((token, k) => k % 2 ? /^[A-Za-z][\w'"]*$/u.test(token) : /^\d+$/u.test(token))) break;
        const block: VibrationalMode[] = [];
        for (let k = 0; k < header.length; k += 2) block.push({ index: Number(header[k]) - 1, frequencyCm1: NaN, symmetry: header[k + 1] });
        if (block.some((mode, k) => mode.index !== modes.length + k)) throw new Error('Out-of-order Molpro normal modes.');
        for (j++; j < lines.length && !COORDINATE_LABEL.test(lines[j].trim().split(/\s+/)[0]); j++) {
          const property = lines[j].match(/^\s*(Wavenumbers \[cm-1\]|Intensities \[km\/mol\]|Intensities \[relative\])\s+(.*)$/u);
          if (!property) throw new Error('Malformed Molpro normal-mode block.');
          const values = property[2].trim().split(/\s+/).map(numeric);
          if (values.length !== block.length) throw new Error('Malformed Molpro normal-mode property.');
          if (property[1].startsWith('Wavenumbers')) block.forEach((mode, k) => { mode.frequencyCm1 = values[k]; });
          else if (property[1].includes('km/mol')) block.forEach((mode, k) => { mode.intensityKmMol = values[k]; });
        }
        const vectors = block.map(() => [] as number[]);
        for (let row = 0; row < n; row++, j++) {
          if (j >= lines.length) return document();
          const p = lines[j].trim().split(/\s+/);
          const label = p[0]?.match(COORDINATE_LABEL);
          if (!label || (Number(label[3]) - 1) * 3 + 'XYZ'.indexOf(label[2]) !== row || p.length !== block.length + 1) throw new Error('Malformed Molpro normal-mode row.');
          p.slice(1).forEach((token, k) => vectors[k].push(numeric(token)));
        }
        if (block.some(mode => !Number.isFinite(mode.frequencyCm1))) throw new Error('Molpro normal mode without a wavenumber.');
        block.forEach((mode, k) => { mode.displacements = frame.atoms.map((_, a) => vectors[k].slice(3 * a, 3 * a + 3) as Vec3); });
        modes.push(...block);
      }
      if (modes.length > n) throw new Error('Molpro mode count exceeds the geometry.');
      // `Normal Modes of low/zero frequencies` (rotations/translations) follow as a separate table.
      frame.modes = modes;
      i = j - 1;
    }
  }
  return document();

  function document(): ScientificDocument {
    const reference = history.frames.length - 1;
    const unrestricted = !!orbitals.beta;
    const list = (spin: 'alpha' | 'beta'): MolecularOrbital[] => orbitalTable(spin, (orbitals[spin] ?? []).map(row => {
      if (unrestricted && row.occupancy > 1) throw new Error('Molpro spin orbital occupation exceeds one.');
      return row;
    }));
    const all = orbitals.frame !== reference || !orbitals.alpha ? [] : [...list('alpha'), ...(unrestricted ? list('beta') : [])];
    return history.document('molpro-log', all, converged);
  }
}

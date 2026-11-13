import type { GaussianShell, MolecularOrbital } from '../scientific-types';
import { cartesianPowers } from '../gaussian-angular';
import { MAX_VALUES, numeric } from './reader-values';

const MOMENTUM: Record<GaussianShell['kind'], number> = { s: 0, p: 1, d: 2, f: 3, g: 4, h: 5, i: 6 };
const KINDS: Record<string, GaussianShell['kind'][]> = { S: ['s'], P: ['p'], SP: ['s', 'p'], D: ['d'], F: ['f'], G: ['g'], H: ['h'], I: ['i'] };
/** AO label column of `pop=full`: number, then on an atom's first row its index and element, then shell number and component. */
const AO_LABEL = /^\s*(\d+)\s+(?:(\d+)\s+[A-Za-z]{1,2}\s+)?(\d+)(S|P[XYZ]|[DFGHI] ?[+-]?\d|[XYZ]{2,6})\s*$/u;

type PrintedShell = { atomIndex: number; kind: GaussianShell['kind']; exponents: number[]; coefficients: number[] };
/** `first` is the zero-based index of the first printed orbital: EOM-CC and `pop=regular` print a window. */
export type GaussianMoSet = { first: number; energies: number[]; occupied: boolean[]; symmetries: (string | undefined)[]; vectors: number[][]; labels: { atom: number; shell: number; component: string }[] };

/**
 * `gfinput`: `AO basis set in the form of general basis input`, one block per atom (`n 0`, shells,
 * `****`). Coefficients refer to normalized primitives; contractions are normalized here, as the
 * program normalizes them.
 */
export function readGeneralBasis(lines: string[], start: number) {
  const shells: PrintedShell[] = [];
  let atomIndex = -1, i = start;
  for (; i < lines.length; i++) {
    const p = lines[i].trim().split(/\s+/);
    if (p.length === 2 && /^\d+$/u.test(p[0]) && p[1] === '0') { atomIndex = Number(p[0]) - 1; continue; }
    if (p[0] === '****') continue;
    const kinds = KINDS[p[0]];
    if (!kinds || p.length !== 4 || atomIndex < 0) break;
    const count = Number(p[1]);
    if (!Number.isInteger(count) || count < 1 || i + count >= lines.length) throw new Error('Malformed Gaussian general basis shell.');
    const rows = lines.slice(i + 1, i + 1 + count).map(row => row.trim().split(/\s+/).map(numeric));
    if (rows.some(row => row.length !== 1 + kinds.length)) throw new Error('Malformed Gaussian general basis primitive.');
    kinds.forEach((kind, k) => shells.push({ atomIndex, kind, exponents: rows.map(row => row[0]), coefficients: rows.map(row => row[1 + k]) }));
    i += count;
  }
  return { shells, end: i };
}

/** `Molecular Orbital Coefficients`: five-column blocks of numbers, symmetry/occupation, eigenvalues and AO rows. */
export function readMoCoefficients(lines: string[], start: number): { set: GaussianMoSet; end: number } | undefined {
  const set: GaussianMoSet = { first: 0, energies: [], occupied: [], symmetries: [], vectors: [], labels: [] };
  let i = start, atom = -1;
  for (;;) {
    const numbers = lines[i]?.trim().split(/\s+/) ?? [];
    if (!numbers.length || !numbers.every(token => /^\d+$/u.test(token))) break;
    if (!set.energies.length) set.first = Number(numbers[0]) - 1;
    if (set.first < 0 || numbers.some((token, k) => Number(token) !== set.first + set.energies.length + k + 1)) throw new Error('Out-of-order Gaussian orbital numbers.');
    // `(BU)--O` with symmetry, or a bare `O`/`V` occupation.
    const flags = (lines[i + 1] ?? '').trim().split(/\s+/).map(token => token.match(/^(?:\(([^)]+)\)--)?([OV])$/u));
    const energies = (lines[i + 2] ?? '').match(/^\s*Eigenvalues --\s+(.*)$/u)?.[1].match(/-?\d+\.\d+/gu);
    if (i + 2 >= lines.length) return undefined;
    if (flags.length !== numbers.length || flags.some(flag => !flag) || energies?.length !== numbers.length) throw new Error('Malformed Gaussian orbital block header.');
    const columns = numbers.map(() => [] as number[]);
    let row = 0;
    for (i += 3; i < lines.length; i++, row++) {
      const label = lines[i].slice(0, 21).match(AO_LABEL);
      if (!label) break;
      if (Number(label[1]) !== row + 1) throw new Error('Malformed Gaussian orbital row.');
      if (label[2]) atom = Number(label[2]) - 1;
      const values = lines[i].slice(21).trim().split(/\s+/).map(numeric);
      if (values.length !== numbers.length || atom < 0) throw new Error('Malformed Gaussian orbital row.');
      const entry = { atom, shell: Number(label[3]), component: label[4].replace(' ', '') };
      if (!set.energies.length) set.labels.push(entry);
      else if (JSON.stringify(set.labels[row]) !== JSON.stringify(entry)) throw new Error('Gaussian orbital rows change between blocks.');
      values.forEach((value, k) => columns[k].push(value));
    }
    if (i >= lines.length) return undefined;
    if (row !== set.labels.length || !row) throw new Error('Truncated Gaussian orbital block.');
    set.energies.push(...energies.map(numeric));
    set.occupied.push(...flags.map(flag => flag![2] === 'O'));
    set.symmetries.push(...flags.map(flag => flag![1]));
    set.vectors.push(...columns);
    if (set.vectors.length * set.labels.length > MAX_VALUES) throw new Error('Gaussian orbitals exceed the browser limit.');
  }
  return set.energies.length ? { set, end: i } : undefined;
}

function normalizedContraction({ kind, exponents, coefficients }: PrintedShell) {
  const l = MOMENTUM[kind];
  let norm = 0;
  exponents.forEach((a, p) => exponents.forEach((b, q) => { norm += coefficients[p] * coefficients[q] * (2 * Math.sqrt(a * b) / (a + b)) ** (l + 1.5); }));
  if (!(norm > 0)) throw new Error('Gaussian basis shell has no normalizable contraction.');
  return coefficients.map(value => value / Math.sqrt(norm));
}

/**
 * Pure components print as `D 0, D+1, D-1, D+2, D-2, ...`, the order Burette's real solid harmonics
 * use; Cartesian components print by axis letters and are permuted into `cartesianPowers` order.
 * Gaussian's AO functions are each normalized (the FCHK convention, see iodata's fchk conventions).
 */
export function gaussianOrbitals(printed: PrintedShell[], sets: { spin: MolecularOrbital['spin']; set: GaussianMoSet; restricted: boolean }[], atomCount: number) {
  const labels = sets[0].set.labels;
  const basis: GaussianShell[] = [];
  const permutation: number[] = [];
  let offset = 0;
  for (const shell of printed) {
    if (shell.atomIndex >= atomCount) throw new Error('Gaussian basis atom is outside the geometry.');
    const l = MOMENTUM[shell.kind];
    const first = labels[offset];
    if (!first || first.atom !== shell.atomIndex) throw new Error('Gaussian orbital rows do not match the basis atoms.');
    const spherical = l >= 2 && /^[DFGHI]/u.test(first.component);
    const size = spherical ? 2 * l + 1 : (l + 1) * (l + 2) / 2;
    const components = labels.slice(offset, offset + size);
    if (components.length !== size || components.some(label => label.atom !== shell.atomIndex || label.shell !== first.shell)) throw new Error('Gaussian orbital rows do not match the basis shells.');
    const entry: GaussianShell = { atomIndex: shell.atomIndex, kind: shell.kind, spherical, exponents: shell.exponents, coefficients: normalizedContraction(shell) };
    const keys = components.map(({ component }) => {
      if (spherical) {
        const m = Number(component.slice(1));
        if (component[0].toLowerCase() !== shell.kind || !Number.isInteger(m) || Math.abs(m) > l) throw new Error('Unrecognised Gaussian pure component.');
        return String(m === 0 ? 0 : 2 * Math.abs(m) - (m > 0 ? 1 : 0));
      }
      if (l === 0) return component === 'S' ? '0,0,0' : '';
      if (l === 1) return component === 'PX' ? '1,0,0' : component === 'PY' ? '0,1,0' : component === 'PZ' ? '0,0,1' : '';
      return [...'XYZ'].map(axis => component.split(axis).length - 1).join();
    });
    const order = spherical ? Array.from({ length: size }, (_, k) => String(k)) : cartesianPowers(entry).map(p => p.join());
    for (const key of order) {
      const k = keys.indexOf(key);
      if (k < 0) throw new Error('Gaussian orbital rows do not match the basis shell components.');
      permutation.push(offset + k);
    }
    basis.push(entry);
    offset += size;
  }
  if (offset !== labels.length) throw new Error('Gaussian orbital rows do not match the basis size.');
  const orbitals = sets.flatMap(({ spin, set, restricted }) => {
    if (JSON.stringify(set.labels) !== JSON.stringify(labels)) throw new Error('Gaussian spin sets use different basis rows.');
    return set.energies.map((energyHartree, index): MolecularOrbital => ({ index, spin, energyHartree, occupancy: set.occupied[index] ? (restricted ? 2 : 1) : 0,
      ...(set.symmetries[index] ? { symmetry: set.symmetries[index] } : {}), coefficients: permutation.map(k => set.vectors[index][k]) }));
  });
  return { basis, orbitals };
}

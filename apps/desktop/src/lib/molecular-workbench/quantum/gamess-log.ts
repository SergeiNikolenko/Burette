import { elementSymbol } from '../elements';
import type { MolecularAtom, Vec3 } from '../types';
import type { GaussianShell, MolecularOrbital, ScientificDocument, VibrationalMode } from '../scientific-types';
import { cartesianPowers } from '../gaussian-angular';
import { hessianFromSquare } from '../hessian';
import { BOHR, coordinate, MAX_VALUES, numeric } from './reader-values';
import { OutputHistory, outputLines } from './output-history';
import { readConvergence } from './convergence';
import type { AdditionalSpectrum } from '../scientific-spectra';
import { absorptionSpectrum, withFrameSpectra, type ExcitedState } from './excited-states';

/** 1 D²/(amu·Å²) in km/mol: N_A/(12 ε₀ c²) with 1 D = 10⁻²¹/c C·m (CODATA 2018 constants). */
const KM_MOL_PER_DEBYE2_AMU_ANGSTROM2 = 42.25606;
const SHELL_KINDS: Record<string, GaussianShell['kind'][]> = { S: ['s'], P: ['p'], D: ['d'], F: ['f'], G: ['g'], H: ['h'], I: ['i'], L: ['s', 'p'] };
const MOMENTUM: Record<GaussianShell['kind'], number> = { s: 0, p: 1, d: 2, f: 3, g: 4, h: 5, i: 6 };
const CORRELATED_ENERGY = /^\s*(?:E\((?:MP2|MP3|MP4)\)\s*=|(?:MBPT\(2\)|CCD|LCCD|CCSD|CCSD\[T\]|CCSD\(T\)|CR-CCSD\[T\]|CR-CCSD\(T\)|CR-CC\(2,3\))\s+ENERGY:)\s*(-\d+\.\d+)/u;

/** A shell of one symmetry-unique atom as printed (normalized-primitive contraction coefficients). */
type PrintedShell = { kind: GaussianShell['kind']; exponents: number[]; coefficients: number[] };
type Orbitals = { energies: number[]; symmetries: (string | undefined)[]; vectors: number[][]; labels: string[] };

/** GAMESS prints coefficients for normalized primitives and normalizes each contracted function to unity. */
function normalizedContraction({ kind, exponents, coefficients }: PrintedShell): number[] {
  const l = MOMENTUM[kind];
  let norm = 0;
  exponents.forEach((a, p) => exponents.forEach((b, q) => { norm += coefficients[p] * coefficients[q] * (2 * Math.sqrt(a * b) / (a + b)) ** (l + 1.5); }));
  if (!(norm > 0)) throw new Error('GAMESS basis shell has no normalizable contraction.');
  return coefficients.map(value => value / Math.sqrt(norm));
}

function atomElement(token: string, charge: number) {
  if (!Number.isInteger(charge) || charge < 1) throw new Error(`GAMESS atom ${token} has no nuclear charge (ghost or dummy centres are not supported).`);
  return elementSymbol(charge);
}

/** `ATOM CHARGE X Y Z` rows up to a blank or dashed line. */
function atomRows(lines: string[], start: number, scale: number) {
  const atoms: MolecularAtom[] = [];
  let i = start;
  for (; i < lines.length && lines[i].trim() && !/^\s*-{5,}/u.test(lines[i]); i++) {
    const p = lines[i].trim().split(/\s+/);
    if (p.length !== 5) throw new Error('Malformed GAMESS coordinate row.');
    atoms.push(coordinate(atomElement(p[0], numeric(p[1])), p.slice(2).map(numeric), scale));
  }
  return { atoms, end: i, complete: i < lines.length && atoms.length > 0 };
}

/** `ATOMIC BASIS SET`: unique atoms in input order, each followed by its numbered shells. */
function basisSection(lines: string[], start: number) {
  const atoms: { shells: PrintedShell[]; numbers: number; lastShell: number }[] = [];
  let shell: { number: number; type: string; exponents: number[]; columns: number[][] } | undefined;
  const flush = () => {
    if (!shell) return;
    const atom = atoms.at(-1);
    if (!atom) throw new Error('GAMESS basis shell precedes its atom.');
    SHELL_KINDS[shell.type].forEach((kind, column) => atom.shells.push({ kind, exponents: shell!.exponents, coefficients: shell!.columns[column] }));
    atom.lastShell = shell.number;
    atom.numbers++;
    shell = undefined;
  };
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*TOTAL NUMBER OF (?:BASIS SET )?SHELLS/u.test(line)) { flush(); return { atoms, end: i }; }
    const p = line.trim().split(/\s+/);
    if (!line.trim()) continue;
    if (p.length === 1 && /^[A-Za-z][\w-]*$/u.test(p[0])) { flush(); atoms.push({ shells: [], numbers: 0, lastShell: 0 }); continue; }
    if (!/^\d+$/u.test(p[0]) || !SHELL_KINDS[p[1]]) continue;
    // Firefly appends the normalized coefficient in parentheses after the unnormalized one.
    const values = line.includes('(') ? [...line.matchAll(/\(\s*(\S+)\s*\)/gu)].map(match => numeric(match[1])) : p.slice(4).map(numeric);
    const width = SHELL_KINDS[p[1]].length;
    if (values.length !== width) throw new Error('Malformed GAMESS basis row.');
    const number = Number(p[0]);
    if (shell && shell.number !== number) flush();
    shell ??= { number, type: p[1], exponents: [], columns: Array.from({ length: width }, () => []) };
    if (shell.type !== p[1]) throw new Error('Malformed GAMESS basis shell.');
    shell.exponents.push(numeric(p[3]));
    values.forEach((value, column) => shell!.columns[column].push(value));
  }
  return { atoms, end: i };
}

/**
 * Symmetry-equivalent atoms follow their unique atom in the coordinate table, and the printed
 * shell number is the last shell of the last copy: the shell-number step gives the copy count.
 */
function expandBasis(unique: ReturnType<typeof basisSection>['atoms'], atoms: MolecularAtom[]): GaussianShell[] {
  const shells: GaussianShell[] = [];
  let atomIndex = 0, previous = 0;
  for (const atom of unique) {
    const printed = atom.numbers, step = atom.lastShell - previous;
    if (!printed || step <= 0 || step % printed) throw new Error('GAMESS basis shell numbering does not match the atoms.');
    for (let copy = 0; copy < step / printed; copy++, atomIndex++) {
      if (atomIndex >= atoms.length) throw new Error('GAMESS basis lists more atoms than the geometry.');
      for (const shell of atom.shells) shells.push({ atomIndex, kind: shell.kind, spherical: false, exponents: shell.exponents, coefficients: normalizedContraction(shell) });
    }
    previous = atom.lastShell;
  }
  if (atomIndex !== atoms.length) throw new Error('GAMESS basis does not cover every atom.');
  return shells;
}

/** AO label (`S`, `X`, `XXY`, ...) of each basis function in GAMESS order. */
function aoPowers(label: string): Vec3 {
  return label === 'S' ? [0, 0, 0] : [...'XYZ'].map(axis => label.split(axis).length - 1) as Vec3;
}

/**
 * Burette stores Cartesian components in `cartesianPowers` (Molden) order; GAMESS prints each shell's
 * components by label (f: XXX YYY ZZZ XXY XXZ YYX YYZ ZZX ZZY XYZ). Returns, for each Burette
 * position, the GAMESS AO index, after checking every printed label against the basis.
 */
function aoPermutation(basis: GaussianShell[], labels: string[]) {
  const permutation: number[] = [];
  let offset = 0;
  for (const shell of basis) {
    const powers = cartesianPowers(shell);
    const printed = labels.slice(offset, offset + powers.length).map(label => {
      const [atom, name] = label.split(':');
      if (Number(atom) !== shell.atomIndex + 1) throw new Error('GAMESS orbital rows do not match the basis atoms.');
      return aoPowers(name).join();
    });
    for (const p of powers) {
      const k = printed.indexOf(p.join());
      if (k < 0 || printed.length !== powers.length) throw new Error('GAMESS orbital rows do not match the basis shells.');
      permutation.push(offset + k);
    }
    offset += powers.length;
  }
  if (offset !== labels.length) throw new Error('GAMESS orbital rows do not match the basis size.');
  return permutation;
}

/** EIGENVECTORS / MOLECULAR ORBITALS: five-column blocks of number, energy, symmetry and AO rows. */
function orbitalSection(lines: string[], start: number): { orbitals: Orbitals; end: number } | undefined {
  const orbitals: Orbitals = { energies: [], symmetries: [], vectors: [], labels: [] };
  let i = start;
  for (;;) {
    while (i < lines.length && (!lines[i].trim() || /^\s*-+\s*$/u.test(lines[i]))) i++;
    const numbers = lines[i]?.trim().split(/\s+/) ?? [];
    if (!numbers.length || !numbers.every(token => /^\d+$/u.test(token))) break;
    if (numbers.some((token, k) => Number(token) !== orbitals.energies.length + k + 1)) throw new Error('Out-of-order GAMESS orbital numbers.');
    const energies = (lines[++i] ?? '').trim().split(/\s+/);
    if (energies.length !== numbers.length) return undefined;
    let symmetries: (string | undefined)[] = numbers.map(() => undefined);
    const next = (lines[i + 1] ?? '').trim().split(/\s+/);
    if (next.length === numbers.length && next.every(token => !/^[-\d.]/u.test(token)) && !/^\s*\d+\s/u.test(lines[i + 1])) { symmetries = next; i++; }
    const columns = numbers.map(() => [] as number[]);
    let row = 0;
    // The last block can run straight into the next message line.
    for (let match; ++i < lines.length && (match = lines[i].match(/^\s*(\d+)\s+[A-Za-z]{1,2}\s*(\d+)\s*(S|[XYZ]+)\s(.*)$/u)); row++) {
      if (Number(match[1]) !== row + 1) throw new Error('Malformed GAMESS orbital row.');
      const values = match[4].trim().split(/\s+/).map(numeric);
      if (values.length !== numbers.length) throw new Error('Malformed GAMESS orbital row.');
      const label = `${match[2]}:${match[3]}`;
      if (orbitals.energies.length === 0) orbitals.labels.push(label);
      else if (orbitals.labels[row] !== label) throw new Error('GAMESS orbital rows change between blocks.');
      values.forEach((value, k) => columns[k].push(value));
    }
    if (i >= lines.length) return undefined; // cut by the end of the file
    if (!row) return undefined;
    if (row !== orbitals.labels.length) throw new Error('Truncated GAMESS orbital block.');
    orbitals.energies.push(...energies.map(numeric));
    orbitals.symmetries.push(...symmetries);
    orbitals.vectors.push(...columns);
    if (orbitals.vectors.length * orbitals.labels.length > MAX_VALUES) throw new Error('GAMESS orbitals exceed the browser limit.');
  }
  return orbitals.energies.length ? { orbitals, end: i } : undefined;
}

/** Fixed-width F9.6 values after the X/Y/Z label: neighbouring values may touch. */
function forceConstantValues(rest: string) {
  const text = rest.replace(/\s+$/u, '');
  if (!text.length || text.length % 9) throw new Error('Malformed GAMESS force-constant row.');
  return Array.from({ length: text.length / 9 }, (_, k) => numeric(text.slice(k * 9, k * 9 + 9).trim()));
}

/**
 * GAMESS-US (and Firefly) output (https://www.msg.chem.iastate.edu/gamess/documentation.html):
 * input coordinates in bohr, optimizer geometries in angstrom; energies Hartree; MO coefficients
 * over every Cartesian AO (also when ISPHER=1 drops spherical contaminants), each AO normalized;
 * Cartesian force constants in Hartree/bohr²; normal modes are Cartesian displacements; IR
 * intensities in debye²/(amu·Å²), converted to km/mol. Rotations/translations are dropped as
 * the program classifies them.
 */
export function parseGamessLog(text: string, name = 'output'): ScientificDocument {
  const lines = outputLines(text);
  const history = new OutputHistory();
  const excited: { frame: number; spectrum: AdditionalSpectrum }[] = [];
  let unique: ReturnType<typeof basisSection>['atoms'] | undefined;
  let scfType: string | undefined;
  const occupied = { alpha: 0, beta: 0 };
  let converged: boolean | undefined;
  let scfFailed = false, scfDone = false;
  let spin: 'alpha' | 'beta' = 'alpha';
  let orbitals: { frame: number; alpha?: Orbitals; beta?: Orbitals } = { frame: -1 };
  let masses: number[] | undefined;
  let rigid: [number, number] | undefined;
  const geometry = (atoms: MolecularAtom[], angstrom: boolean) => {
    const before = history.frames.at(-1), frame = history.geometry(atoms);
    if (frame !== before) { scfDone = false; scfFailed = false; }
    // The bohr input table went through GAMESS's own bohr constant; its angstrom reprint is exact.
    else if (angstrom) frame.atoms = atoms;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*ATOM\s+ATOMIC\s+COORDINATES \(BOHR\)\s*$/u.test(line)) {
      const { atoms, end, complete } = atomRows(lines, i + 2, BOHR);
      if (!complete) break;
      geometry(atoms, false);
      i = end;
      continue;
    }
    if (/^\s*COORDINATES OF ALL ATOMS ARE \(ANGS\)\s*$/u.test(line)) {
      if (!/^\s*-{5,}/u.test(lines[i + 2] ?? '')) break;
      const { atoms, end, complete } = atomRows(lines, i + 3, 1);
      if (!complete) break;
      geometry(atoms, true);
      i = end;
      continue;
    }
    if (/^\s*ATOMIC BASIS SET\s*$/u.test(line)) {
      const section = basisSection(lines, i + 1);
      if (section.end >= lines.length) break;
      unique = section.atoms;
      i = section.end;
      continue;
    }
    const convergenceEnd = readConvergence('gamess', lines, i, history.frames.at(-1));
    if (convergenceEnd >= 0) { i = convergenceEnd; continue; }
    // Rows `n SYM E(Eh) ΔE(eV) X Y Z f` after the ground state's `0 SYM E 0.000`.
    if (/^\s*SUMMARY OF TDDFT RESULTS\s*$/u.test(line) && history.frames.length) {
      const states: ExcitedState[] = [];
      let j = i + 1;
      while (j < lines.length && !/^\s*0\s+\S+\s+\S+\s+0\.0+\s*$/u.test(lines[j]) && j < i + 6) j++;
      for (j++; j < lines.length; j++) {
        const row = lines[j].match(/^\s*(\d+)\s+(\S+)\s+\S+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/u);
        if (!row) break;
        states.push({ label: `${row[1]} ${row[2]}`, energyEv: numeric(row[3]), oscillatorStrength: numeric(row[7]),
          transitionDipoleAu: [numeric(row[4]), numeric(row[5]), numeric(row[6])] });
      }
      if (!states.length) throw new Error('Malformed GAMESS TDDFT summary.');
      excited.push({ frame: history.frames.length - 1, spectrum: absorptionSpectrum(states) });
      i = j - 1;
      continue;
    }
    let match = line.match(/^\s*SCFTYP=(\S+)/u);
    if (match) { scfType ??= match[1]; continue; }
    match = line.match(/^\s*NUMBER OF OCCUPIED ORBITALS \((ALPHA|BETA )\)\s*=\s*(\d+)\s*$/u);
    if (match) { occupied[match[1] === 'ALPHA' ? 'alpha' : 'beta'] = Number(match[2]); continue; }
    if (/SCF IS UNCONVERGED|DENSITY MATRIX DID NOT CONVERGE/u.test(line)) { scfFailed = true; converged = false; continue; }
    match = line.match(/^\s*FINAL (?:\S+ )?ENERGY IS\s+(\S+)\s+AFTER/u);
    if (match) {
      // An unconverged SCF prints a placeholder energy (0.0) that is not a result.
      if (!scfFailed) history.scfEnergy(numeric(match[1]));
      scfDone = true;
      spin = 'alpha';
      continue;
    }
    match = line.match(CORRELATED_ENERGY);
    if (match) { history.correlatedEnergy(numeric(match[1])); continue; }
    if (/\*{5} EQUILIBRIUM GEOMETRY LOCATED \*{5}/u.test(line)) converged = true;
    if (/FAILURE TO LOCATE STATIONARY POINT|EXECUTION OF GAMESS TERMINATED -ABNORMALLY-/u.test(line)) converged = false;
    if (/^\s*-{5} (ALPHA|BETA) SET -{5}\s*$/u.test(line)) { spin = /BETA/u.test(line) ? 'beta' : 'alpha'; continue; }
    if (/^\s*(EIGENVECTORS|MOLECULAR ORBITALS)\s*$/u.test(line) && /^\s*-{5,}\s*$/u.test(lines[i + 1] ?? '')) {
      const section = orbitalSection(lines, i + 2);
      if (!section) continue;
      i = section.end - 1;
      // Only the converged-or-final SCF of a printed geometry owns orbitals, never a trial step.
      if (!scfDone || history.trial) continue;
      const frame = history.frames.length - 1;
      if (orbitals.frame !== frame || spin === 'alpha') orbitals = { frame };
      orbitals[spin] = section.orbitals;
      continue;
    }
    if (/^\s*TOTAL MULLIKEN AND LOWDIN ATOMIC POPULATIONS\s*$/u.test(line)) {
      if (!/CHARGE/u.test(lines[i + 1] ?? '')) continue; // per-spin populations carry no charge column
      const mulliken: number[] = [], lowdin: number[] = [];
      let j = i + 2;
      for (; j < lines.length && lines[j].trim(); j++) {
        const p = lines[j].trim().split(/\s+/);
        if (p.length === 4) continue; // a population-only echo of the next row
        if (p.length !== 6 || Number(p[0]) !== mulliken.length + 1) throw new Error('Malformed GAMESS population row.');
        mulliken.push(numeric(p[3]));
        lowdin.push(numeric(p[5]));
      }
      if (j >= lines.length) break;
      history.charges('mulliken', mulliken);
      history.charges('lowdin', lowdin);
      i = j;
      continue;
    }
    if (/^\s*DX\s+DY\s+DZ\s+\/D\/\s+\(DEBYE\)\s*$/u.test(line)) {
      const p = (lines[i + 1] ?? '').trim().split(/\s+/);
      if (i + 1 >= lines.length) break;
      if (p.length !== 4) throw new Error('Malformed GAMESS dipole row.');
      history.dipole(p.slice(0, 3).map(numeric) as Vec3);
      i++;
      continue;
    }
    if (/^\s*CARTESIAN FORCE CONSTANT MATRIX\s*$/u.test(line)) {
      const frame = history.current('Hessian');
      const n = frame.atoms.length * 3;
      const values = new Array<number | undefined>(n * n);
      let columns: number[] = [], row = -1, j = i + 2, complete = false;
      for (; j < lines.length; j++) {
        const current = lines[j];
        if (!current.trim()) continue;
        const p = current.trim().split(/\s+/);
        if (p.every(token => /^\d+$/u.test(token))) { columns = p.flatMap(token => [0, 1, 2].map(axis => (Number(token) - 1) * 3 + axis)); continue; }
        if (p.every(token => /^[A-Za-z]+$/u.test(token))) continue; // atom labels or X Y Z headings
        const label = current.match(/^\s*(?:(\d+)\s+\S+\s+)?([XYZ])/u);
        if (!label) break;
        row = label[1] ? (Number(label[1]) - 1) * 3 : row + 1;
        if ('XYZ'.indexOf(label[2]) !== row % 3 || row >= n) throw new Error('Malformed GAMESS force-constant row.');
        const entries = forceConstantValues(current.slice(label[0].length));
        if (entries.length !== columns.length) throw new Error('Malformed GAMESS force-constant row.');
        entries.forEach((value, k) => { values[row * n + columns[k]] = value; });
        if (row === n - 1 && columns.at(-1) === n - 1) { complete = true; j++; break; }
      }
      if (!complete) break;
      // Blocks cover rows at or below their column atoms; fill the rest by symmetry.
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) values[r * n + c] ??= values[c * n + r];
      if (values.some(value => value === undefined)) throw new Error('Incomplete GAMESS force-constant matrix.');
      frame.hessian = hessianFromSquare(values as number[], frame.atoms.length, 'gamess-log', masses?.length === frame.atoms.length ? masses : undefined);
      i = j - 1;
      continue;
    }
    if (/^\s*ATOMIC WEIGHTS \(AMU\)\s*$/u.test(line)) {
      const frame = history.current('masses');
      const weights: number[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      for (; j < lines.length && lines[j].trim(); j++) {
        const p = lines[j].trim().split(/\s+/);
        if (p.length !== 3 || Number(p[0]) !== weights.length + 1) throw new Error('Malformed GAMESS atomic weight row.');
        weights.push(numeric(p[2]));
      }
      if (weights.length !== frame.atoms.length) break;
      masses = weights;
      if (frame.hessian && !frame.hessian.massesAmu) frame.hessian = hessianFromSquare(frame.hessian.values, frame.atoms.length, 'gamess-log', weights);
      i = j - 1;
      continue;
    }
    match = line.match(/^\s*MODES\s+(\d+)\s+TO\s+(\d+)\s+ARE TAKEN AS ROTATIONS AND TRANSLATIONS\.\s*$/u);
    if (match) { rigid = [Number(match[1]), Number(match[2])]; continue; }
    if (/^\s*FREQUENCY:/u.test(line)) {
      const frame = history.current('normal modes');
      const numbers = (lines[i - 1] ?? '').trim().split(/\s+/).map(Number);
      const tokens = line.split(':')[1].trim().split(/\s+/);
      const frequencies: number[] = [];
      for (const token of tokens) {
        if (token === 'I' && frequencies.length) frequencies[frequencies.length - 1] = -Math.abs(frequencies.at(-1)!);
        else frequencies.push(numeric(token));
      }
      if (numbers.length !== frequencies.length || !numbers.every(Number.isInteger)) throw new Error('Malformed GAMESS frequency block.');
      const block: (VibrationalMode & { number: number })[] = frequencies.map((frequencyCm1, k) => ({ number: numbers[k], index: 0, frequencyCm1 }));
      let j = i + 1;
      const properties: [RegExp, (mode: VibrationalMode, value: string) => void][] = [
        [/^\s*SYMMETRY:/u, (mode, value) => { mode.symmetry = value; }],
        [/^\s*REDUCED MASS:/u, (mode, value) => { mode.reducedMassAmu = numeric(value); }],
        [/^\s*IR INTENSITY:/u, (mode, value) => { mode.intensityKmMol = numeric(value) * KM_MOL_PER_DEBYE2_AMU_ANGSTROM2; }],
        [/^\s*RAMAN ACTIVITY:/u, (mode, value) => { mode.ramanActivityAngstrom4Amu = numeric(value); }],
        [/^\s*DEPOLARIZATION:/u, (mode, value) => { mode.ramanDepolarizationRatio = numeric(value); }],
      ];
      for (; j < lines.length && lines[j].trim(); j++) {
        const property = properties.find(([pattern]) => pattern.test(lines[j]));
        if (!property) throw new Error('Unrecognised GAMESS normal-mode property.');
        const values = lines[j].split(':')[1].trim().split(/\s+/);
        if (values.length !== block.length) throw new Error('Malformed GAMESS normal-mode property.');
        block.forEach((mode, k) => property[1](mode, values[k]));
      }
      j++;
      const vectors = block.map(() => [] as number[]);
      for (let r = 0; r < frame.atoms.length * 3; r++, j++) {
        if (j >= lines.length) return finish();
        const label = lines[j].match(/^\s*(?:\d+\s+\S+\s+)?([XYZ])\s/u);
        if (!label || 'XYZ'.indexOf(label[1]) !== r % 3) throw new Error('Malformed GAMESS normal-mode row.');
        const values = lines[j].slice(label[0].length).trim().split(/\s+/).map(numeric);
        if (values.length !== block.length) throw new Error('Malformed GAMESS normal-mode row.');
        values.forEach((value, k) => vectors[k].push(value));
      }
      block.forEach((mode, k) => { mode.displacements = frame.atoms.map((_, atom) => vectors[k].slice(atom * 3, atom * 3 + 3) as Vec3); });
      // A new analysis starts again at mode 1.
      const modes = numbers[0] === 1 ? [] : (frame.modes ?? []) as (VibrationalMode & { number?: number })[];
      modes.push(...block);
      frame.modes = modes;
      i = j - 1;
    }
  }
  return withFrameSpectra(finish(), name, excited);

  function finish(): ScientificDocument {
    const document = history.document('gamess-log', [], converged);
    for (const frame of history.frames) {
      if (!frame.modes) continue;
      frame.modes = (frame.modes as (VibrationalMode & { number?: number })[])
        .filter(mode => !rigid || mode.number! < rigid[0] || mode.number! > rigid[1])
        .map(({ number: _number, ...mode }, index) => ({ ...mode, index }));
    }
    document.modes = document.frames.at(-1)!.modes ?? [];
    const reference = history.frames.length - 1;
    if (orbitals.frame !== reference || !orbitals.alpha || !unique || !/^(?:RHF|UHF|ROHF)$/u.test(scfType ?? '')) return document;
    const basis = expandBasis(unique, document.atoms);
    const permutation = aoPermutation(basis, orbitals.alpha.labels);
    const unrestricted = scfType === 'UHF';
    if (unrestricted !== !!orbitals.beta) throw new Error('GAMESS orbital spin sets do not match the SCF type.');
    const table = (set: Orbitals, which: 'alpha' | 'beta'): MolecularOrbital[] => set.energies.map((energyHartree, n) => {
      if (set.labels.join() !== orbitals.alpha!.labels.join()) throw new Error('GAMESS spin sets use different basis rows.');
      const occupancy = unrestricted ? (n < occupied[which] ? 1 : 0) : n < occupied.beta ? 2 : n < occupied.alpha ? 1 : 0;
      return { index: n, spin: which, energyHartree, occupancy, ...(set.symmetries[n] ? { symmetry: set.symmetries[n] } : {}), coefficients: permutation.map(k => set.vectors[n][k]) };
    });
    document.basis = basis;
    document.orbitals = [...table(orbitals.alpha, 'alpha'), ...(orbitals.beta ? table(orbitals.beta, 'beta') : [])];
    return document;
  }
}

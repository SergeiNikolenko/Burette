import { atomicNumber } from '../elements';
import { hessianFromSquare } from '../hessian';
import type { AtomicChargeSet, ScientificDocument, ScientificFrame, VibrationalMode } from '../scientific-types';
import type { MolecularAtom, Vec3 } from '../types';
import { DEBYE_PER_AU, outputLines } from './output-history';
import { BOHR, checkIdentity, coordinate, MAX_ATOMS, MAX_FRAMES, MAX_VALUES, numeric } from './reader-values';
import { thermochemistry, type Printed } from './thermochemistry';

const HARTREE_KCAL_MOL = 627.5094740631;

/** What one `GeometryIndex` of the property file states about that geometry. */
interface Geometry {
  atoms?: MolecularAtom[];
  /** ORCA's final single-point energy, dispersion included. */
  final?: number;
  scf?: number;
  vdw?: number;
  charges: AtomicChargeSet[];
  dipoleAu?: number[];
  gradient?: number[];
  hessian?: Float64Array;
  modes?: { values: Float64Array; count: number };
  frequencies?: number[];
  /** The thermochemistry print; its entropy is T·S in Hartree. */
  thermochemistry?: Partial<Record<Printed, number>>;
  failed?: boolean;
}
type Geometries = Map<number, Geometry>;
function at(geometries: Geometries, index: number) {
  if (!Number.isInteger(index) || index < 1 || index > MAX_FRAMES) throw new Error('Invalid ORCA property geometry index.');
  let geometry = geometries.get(index);
  if (!geometry) geometries.set(index, geometry = { charges: [] });
  return geometry;
}
function count(token: string | undefined, maximum: number) {
  const value = Number(token);
  if (!/^\d+$/.test(token ?? '') || value > maximum) throw new Error('Invalid ORCA property count.');
  return value;
}

/**
 * ORCA's chunked matrix print: a line of consecutive column indices, then `row value...`
 * lines, repeated for the next columns. Reading stops at the first other non-blank line.
 */
function readTable(lines: readonly string[], rows: number, columns: number, start = 0) {
  if (!rows || !columns || rows * columns > MAX_VALUES) throw new Error('ORCA property matrix exceeds the browser limit.');
  const values = new Float64Array(rows * columns), seen = new Uint8Array(rows * columns);
  let header: number[] = [], filled = 0;
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    if (header.length && parts.length === header.length + 1 && /^\d+$/.test(parts[0])) {
      const row = count(parts[0], rows - 1);
      header.forEach((column, k) => {
        const index = row * columns + column;
        if (seen[index]) throw new Error('Duplicate ORCA property matrix entry.');
        seen[index] = 1; values[index] = numeric(parts[k + 1]); filled++;
      });
    } else if (parts.every(part => /^\d+$/.test(part)) && parts.every((part, k) => Number(part) === Number(parts[0]) + k) && Number(parts.at(-1)) < columns) {
      header = parts.map(Number);
    } else if (header.length) break;
  }
  if (filled !== values.length) throw new Error('Truncated ORCA property matrix.');
  return values;
}

type Entry = { attributes: string; value: string; lines: string[] };
type Entries = Map<string, Entry | null>;
function one(entries: Entries, name: string) {
  const entry = entries.get(name);
  if (entry === null) throw new Error(`Duplicate ORCA property ${name}.`);
  return entry;
}
/** ORCA 5.1+ (`$Name`, `&GeometryIndex n`, `&KEY [&Type "...", &Dim (r,c), &Units "..."] value`, `$End`). */
function readKeyed(lines: string[], geometries: Geometries) {
  type Block = { name: string; geometry?: number; entries: Entries };
  const blocks: Block[] = [];
  let block: Block | undefined, entry: Entry | undefined;
  const finish = () => { if (block) blocks.push(block); block = entry = undefined; };
  for (const line of lines) {
    const trimmed = line.trim();
    const header = trimmed.match(/^\$(\w+)$/);
    if (header) {
      // ORCA 6.0 can open a block twice without an `$End` in between.
      finish();
      if (header[1] !== 'End') block = { name: header[1].toLowerCase(), entries: new Map() };
      continue;
    }
    if (!block) {
      if (trimmed && !/^\*+(?: ORCA \d+\.\d+\.\d+ \*+)?$/.test(trimmed)) throw new Error('ORCA property text outside a block.');
      continue;
    }
    const key = trimmed.match(/^&(\w+)\s*(?:\[([^\]]*)\])?\s*(.*)$/);
    if (key) {
      const name = key[1].toLowerCase();
      if (name === 'geometryindex') block.geometry = count(key[3], MAX_FRAMES);
      else {
        entry = { attributes: key[2] ?? '', value: key[3], lines: [] };
        // Per-nucleus blocks repeat their keys; a repeated key is only an error where it is read.
        block.entries.set(name, block.entries.has(name) ? null : entry);
      }
      continue;
    }
    if (trimmed && !entry) throw new Error('ORCA property value outside an entry.');
    entry?.lines.push(line);
  }
  if (block) throw new Error('Truncated ORCA property file.');
  // Geometries first: every property is checked against the atoms of its own geometry.
  for (const { name, geometry, entries } of [...blocks.filter(b => b.name === 'geometry'), ...blocks.filter(b => b.name !== 'geometry')]) {
    if (geometry !== undefined && name !== 'calculation_status') keyedBlock(name, entries, at(geometries, geometry));
  }
  return [...blocks].reverse().find(b => b.name === 'calculation_status')?.entries.get('status')?.value.trim();
}
function dimension(entry: Entry) {
  const match = entry.attributes.match(/&Dim\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!match) throw new Error('ORCA property array has no dimensions.');
  return [count(match[1], MAX_VALUES), count(match[2], MAX_VALUES)] as const;
}
function keyedArray(entries: Entries, name: string, rows?: number, columns?: number) {
  const entry = one(entries, name);
  if (!entry) return undefined;
  const [r, c] = dimension(entry);
  if ((rows !== undefined && r !== rows) || (columns !== undefined && c !== columns)) throw new Error(`ORCA property ${name} has unexpected dimensions.`);
  return readTable(entry.lines, r, c);
}
function keyedScalar(entries: Entries, name: string) {
  const value = one(entries, name)?.value.trim().split(/\s+/)[0];
  return value === undefined ? undefined : numeric(value);
}
function keyedBlock(name: string, entries: Entries, geometry: Geometry) {
  if (name === 'geometry') {
    const entry = one(entries, 'cartesiancoordinates');
    if (!entry) throw new Error('ORCA property geometry has no coordinates.');
    const [rows, columns] = dimension(entry);
    if (rows < 1 || rows > MAX_ATOMS || columns !== 4) throw new Error('Invalid ORCA property geometry dimensions.');
    const units = entry.attributes.match(/&Units\s*"([^"]*)"/)?.[1];
    if (units !== 'Bohr') throw new Error('Unsupported ORCA property coordinate units.');
    const rowsText = entry.lines.map(line => line.trim()).filter(Boolean);
    if (rowsText.length !== rows) throw new Error('Truncated ORCA property geometry.');
    if (geometry.atoms) throw new Error('Duplicate ORCA property geometry.');
    geometry.atoms = rowsText.map(line => {
      const parts = line.split(/\s+/);
      if (parts.length !== 4) throw new Error('Malformed ORCA property coordinate row.');
      return coordinate(parts[0], parts.slice(1).map(numeric), BOHR);
    });
    return;
  }
  if (!/^(?:single_point_data|calculation_info|scf_energy|vdw_correction|(?:scf_)?(?:mulliken|loewdin)_population_analysis|scf_dipole_moment|\w+_nuc_gradient|hessian|thermochemistry_energies)$/.test(name)) return;
  const atomCount = geometry.atoms?.length;
  if (!atomCount) throw new Error('ORCA property refers to a missing geometry.');
  if (name === 'single_point_data') {
    geometry.final = keyedScalar(entries, 'finalenergy') ?? geometry.final;
    if (one(entries, 'converged')?.value.trim() === 'false') geometry.failed = true;
  } else if (name === 'calculation_info') geometry.final ??= keyedScalar(entries, 'totalenergy');
  else if (name === 'scf_energy') geometry.scf = keyedScalar(entries, 'scf_energy') ?? keyedArray(entries, 'totalenergy', undefined, 1)?.[0];
  else if (name === 'vdw_correction') geometry.vdw = keyedScalar(entries, 'vdw');
  else if (/^(?:scf_)?(?:mulliken|loewdin)_population_analysis$/.test(name)) {
    const values = keyedArray(entries, 'atomiccharges', atomCount, 1), numbers = keyedArray(entries, 'atno', atomCount, 1);
    if (!values || numbers?.some((z, i) => z !== atomicNumber(geometry.atoms![i].element))) throw new Error('ORCA property charges do not match the geometry.');
    geometry.charges.push({ model: name.includes('mulliken') ? 'mulliken' : 'lowdin', values: Array.from(values) });
  } else if (name === 'scf_dipole_moment') {
    const total = keyedArray(entries, 'dipoletotal', 3, 1);
    if (total) geometry.dipoleAu = Array.from(total);
  } else if (/_nuc_gradient$/.test(name)) {
    const gradient = keyedArray(entries, 'grad', 3 * atomCount, 1);
    if (gradient) geometry.gradient = Array.from(gradient);
  } else if (name === 'hessian') {
    geometry.hessian = keyedArray(entries, 'hessian', 3 * atomCount, 3 * atomCount);
    const modes = one(entries, 'modes');
    if (modes) geometry.modes = { values: keyedArray(entries, 'modes', 3 * atomCount)!, count: dimension(modes)[1] };
  } else if (name === 'thermochemistry_energies') {
    const frequencies = keyedArray(entries, 'freq', keyedScalar(entries, 'numoffreqs'), 1);
    if (frequencies) geometry.frequencies = Array.from(frequencies);
    geometry.thermochemistry = { temperature: keyedScalar(entries, 'temperature'), zeroPoint: keyedScalar(entries, 'zpe'), enthalpy: keyedScalar(entries, 'enthalpyh'),
      entropyTerm: keyedScalar(entries, 'entropys'), gibbs: keyedScalar(entries, 'freeenergyg') };
  }
}

/** ORCA ≤ 5.0 (`!PROPERTIES!`, `$ Name` blocks with `geom. index:`, then `!GEOMETRIES!` in angstrom). */
function readListed(lines: string[], geometries: Geometries) {
  const start = lines.findIndex(line => /!GEOMETRIES!/.test(line));
  if (start < 0) throw new Error('ORCA property file has no geometries.');
  for (let i = start; i < lines.length; i++) {
    if (!/!GEOMETRY!/.test(lines[i])) continue;
    const atoms = count(lines[i + 1]?.match(/Number of atoms:\s*(\d+)/)?.[1], MAX_ATOMS);
    const geometry = at(geometries, count(lines[i + 2]?.match(/Geometry Index:\s*(\d+)/)?.[1], MAX_FRAMES));
    if (geometry.atoms || !/Coordinates:/.test(lines[i + 3] ?? '')) throw new Error('Malformed ORCA property geometry.');
    geometry.atoms = lines.slice(i + 4, i + 4 + atoms).map((line, k) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length !== 5 || Number(parts[0]) !== k) throw new Error('Truncated ORCA property geometry.');
      return coordinate(parts[1], parts.slice(2).map(numeric));
    });
  }
  for (let i = 0; i < start; i++) {
    const name = lines[i].match(/^\$ (\w+)\s*$/)?.[1];
    if (!name) continue;
    let end = i + 1;
    while (end < start && !/^\$ |^# -+$/.test(lines[end])) end++;
    const body = lines.slice(i + 1, end), text = body.join('\n');
    const geometry = at(geometries, count(text.match(/geom\. index:\s*(\d+)/)?.[1], MAX_FRAMES));
    const value = (pattern: RegExp) => { const match = text.match(pattern); return match ? numeric(match[1]) : undefined; };
    const table = (label: RegExp, rows: number, columns: number) => {
      const line = body.findIndex(row => label.test(row));
      return line < 0 ? undefined : readTable(body, rows, columns, line + 1);
    };
    const atomCount = geometry.atoms?.length;
    if (!atomCount) throw new Error('ORCA property refers to a missing geometry.');
    if (name === 'SCF_Energy') geometry.scf = value(/SCF Energy:\s+(\S+)/);
    else if (name === 'VdW_Correction') geometry.vdw = value(/Van der Waals Correction:\s+(\S+)/);
    else if (name === 'Mayer_Pop') {
      // NA, ZA, QA (Mulliken gross atomic charge), VA, BVA, FA after the atom index and fragment.
      const header = body.findIndex(row => /^\s*ATOM\s+NA\s+ZA\s+QA\s+VA\s+BVA\s+FA\s*$/.test(row));
      if (header < 0) throw new Error('Unsupported ORCA Mayer population table.');
      const rows = body.slice(header + 1, header + 1 + atomCount).map(row => row.trim().split(/\s+/));
      if (rows.some((row, k) => row.length !== 8 || Number(row[0]) !== k)) throw new Error('Truncated ORCA Mayer population table.');
      geometry.charges = [...geometry.charges.filter(set => set.model !== 'mulliken'), { model: 'mulliken', values: rows.map(row => numeric(row[4])) }];
    } else if (name === 'SCF_Electric_Properties') {
      const total = table(/Total Dipole moment:/, 3, 1);
      if (total) geometry.dipoleAu = Array.from(total);
    } else if (name === 'Hessian') {
      const size = text.match(/Number of Rows:\s*(\d+)\s+Number of Columns:\s*(\d+)/);
      if (!size || Number(size[1]) !== 3 * atomCount) throw new Error('ORCA property normal modes do not match the geometry.');
      const modeCount = count(size[2], 3 * atomCount);
      geometry.modes = { values: table(/Normal modes:/, 3 * atomCount, modeCount)!, count: modeCount };
    } else if (name === 'THERMOCHEMISTRY_Energies') {
      const frequencies = table(/Vibrational frequencies\s*:/, count(text.match(/Number of frequencies\s*:\s*(\d+)/)?.[1], 3 * atomCount), 1);
      if (frequencies) geometry.frequencies = Array.from(frequencies);
      geometry.thermochemistry = { temperature: value(/Temperature \(Kelvin\)\s*:\s*(\S+)/), zeroPoint: value(/Zero Point Energy \(Hartree\)\s*:\s*(\S+)/),
        enthalpy: value(/Enthalpy \(Hartree\)\s*:\s*(\S+)/), entropyTerm: value(/^\s*Entropy\s*:\s*(\S+)/m), gibbs: value(/Gibbs Energy \(Hartree\)\s*:\s*(\S+)/) };
    }
  }
}

/**
 * ORCA's `.property.txt` (ORCA 6) or `_property.txt` (ORCA 5): geometries, energies, SCF charges,
 * dipoles, gradients, the Cartesian Hessian (Hartree/bohr², ORCA 6 only) and normal modes per
 * geometry index. Normal-mode columns are ORCA's normalized Cartesian displacements, including
 * the zero-frequency rigid motions. The file states no atomic masses.
 */
export function parseOrcaProperty(text: string): ScientificDocument {
  const lines = outputLines(text);
  const geometries: Geometries = new Map();
  const listed = lines.slice(0, 8).some(line => /!PROPERTIES!/.test(line));
  const status = listed ? undefined : readKeyed(lines, geometries);
  if (listed) readListed(lines, geometries);
  const indices = [...geometries.keys()].sort((a, b) => a - b);
  if (!indices.length || indices.some((index, k) => index !== k + 1)) throw new Error('ORCA property geometries are missing or not contiguous.');
  let values = 0;
  const frames = indices.map(index => {
    const geometry = geometries.get(index)!;
    if (!geometry.atoms) throw new Error('ORCA property refers to a missing geometry.');
    const atoms = geometry.atoms, n = atoms.length;
    values += 3 * n;
    if (values > MAX_VALUES) throw new Error('ORCA property geometry history exceeds the browser limit.');
    const frame: ScientificFrame = { atoms };
    const energy = geometry.final ?? (geometry.scf === undefined ? undefined : geometry.scf + (geometry.vdw ?? 0));
    if (energy !== undefined) frame.energyHartree = energy;
    if (geometry.charges.length) frame.charges = geometry.charges;
    const thermo = geometry.thermochemistry && thermochemistry(geometry.thermochemistry, energy);
    if (thermo) frame.thermochemistry = thermo;
    if (geometry.dipoleAu) frame.dipoleDebye = geometry.dipoleAu.map(value => value * DEBYE_PER_AU) as Vec3;
    if (geometry.gradient) frame.forcesKcalMolAngstrom = atoms.map((_, i) => geometry.gradient!.slice(3 * i, 3 * i + 3).map(value => -value * HARTREE_KCAL_MOL / BOHR) as Vec3);
    if (geometry.hessian) frame.hessian = hessianFromSquare(geometry.hessian, n, 'orca-property');
    if (geometry.modes) {
      const frequencies = geometry.frequencies;
      if (!frequencies || frequencies.length !== geometry.modes.count) throw new Error('ORCA property normal modes and frequencies disagree.');
      const { values: matrix, count: modeCount } = geometry.modes;
      frame.modes = frequencies.map((frequencyCm1, index): VibrationalMode => ({ index, frequencyCm1,
        displacements: atoms.map((_, i) => [0, 1, 2].map(axis => matrix[(3 * i + axis) * modeCount + index]) as Vec3) }));
    } else if (geometry.frequencies) frame.modes = geometry.frequencies.map((frequencyCm1, index) => ({ index, frequencyCm1 }));
    return frame;
  });
  frames.forEach(frame => checkIdentity(frame.atoms, frames[0].atoms));
  const failed = (status !== undefined && !/NORMAL TERMINATION/.test(status)) || geometries.get(indices.at(-1)!)!.failed;
  const last = frames.at(-1)!;
  return { format: 'orca-property', atoms: last.atoms, referenceFrameIndex: frames.length - 1, frames, modes: last.modes ?? [], orbitals: [], ...(failed ? { converged: false } : {}) };
}

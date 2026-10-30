import type { ScientificFrame, VibrationalMode, MolecularOrbital, GaussianShell, ScalarGrid, ScientificDocument } from "./scientific-types";
export type { ScientificFrame, VibrationalMode, MolecularOrbital, GaussianShell, ScalarGrid, ScientificDocument } from "./scientific-types";
import type { MolecularAtom, Vec3 } from "./types";
import { atomicNumber, elementSymbol } from "./elements";
import { parseXyz, serializeXyz } from "./xyz";
import { parseExtendedFrame, trajectoryMetadata } from "./trajectory-metadata";
import { parseGaussianLog } from "./quantum/gaussian-log";
import { readOrcaVcdTables } from "./orca-circular-spectra";
import { withOrcaSourceSpectra, type OrcaSourceSpectrum } from "./orca-source-spectra";
import { validateParsedSpectra } from "./parsed-spectral-document";
import { parseQcschema } from "./quantum/qcschema";
import { parseFchk } from "./fchk";
import { parseMolden } from "./gaussian";
import { hessianFromOrcaSection } from "./hessian";
import { atomsFromZmatrixDocument, parseZmatrixDocument } from "../../../../../scripts/zmatrix-document.mjs";

export const BOHR_ANGSTROM = 0.529177210903;
const MAX_TEXT = 16 * 1024 * 1024;
const MAX_ATOMS = 10_000;
const MAX_FRAMES = 2_000;
const MAX_GRID = 1_000_000;
const MAX_MODE_VALUES = 2_000_000;


function number(value: string | undefined): number {
  if (!value || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?$/.test(value)) throw new Error("Invalid scientific number.");
  const parsed = Number(value.replace(/[dD]/, "e"));
  if (!Number.isFinite(parsed)) throw new Error("Non-finite scientific number.");
  return parsed;
}
function integer(value: string | undefined, maximum: number, allowZero = false) {
  const parsed = number(value);
  if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1) || parsed > maximum) throw new Error("Scientific data exceeds supported dimensions.");
  return parsed;
}
function fields(line: string) { return line.trim().split(/\s+/); }
function atom(element: string, xyz: string[], scale = 1): MolecularAtom {
  atomicNumber(element);
  const [x, y, z] = xyz.map(number).map(value => value * scale);
  if (xyz.length !== 3 || Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 1e6) throw new Error("Invalid atomic coordinates.");
  return { element, x, y, z };
}
function empty(format: ScientificDocument["format"], atoms: MolecularAtom[]): ScientificDocument {
  if (!atoms.length || atoms.length > MAX_ATOMS) throw new Error("No supported atomic geometry was found.");
  return { format, atoms, frames: [{ atoms }], modes: [], orbitals: [] };
}
function checkFrames(frames: ScientificFrame[]) {
  if (!frames.length || frames.length > MAX_FRAMES) throw new Error("Unsupported trajectory size.");
  const elements = frames[0].atoms.map(item => item.element);
  for (const frame of frames) {
    if (frame.atoms.length !== elements.length || frame.atoms.some((item, i) => item.element !== elements[i])) throw new Error("Trajectory atom identity changes between frames.");
  }
}

export function parseScientificFile(name: string, text: string): ScientificDocument {
  if (text.length > MAX_TEXT || text.includes("\0") || new TextEncoder().encode(text).byteLength > MAX_TEXT) throw new Error("Scientific text must be at most 16 MiB and contain no binary data.");
  if (/\.(?:zmat|zmatrix)$/i.test(name)) {
    const internalCoordinates = parseZmatrixDocument(text);
    const atoms = atomsFromZmatrixDocument(internalCoordinates).map(({ element, position: [x, y, z] }) => ({ element, x, y, z }));
    return { ...empty("zmat", atoms), internalCoordinates };
  }
  if (/\.(?:qcschema|json)$/i.test(name)) return parseQcschema(text, name);
  if (/\.(?:fchk|fch)$/i.test(name)) return parseFchk(text);
  if (/\.(?:cube|cub)$/i.test(name)) return parseCube(text);
  if (/\.xyz$/i.test(name)) return parseXyzTrajectory(text);
  if (/\.(?:molden|molf)$|(?:^|[._-])molden\.input$/i.test(name)) return parseMolden(text);
  if (/\.hess$/i.test(name)) return parseHessian(text);
  if (/^\s*\{/.test(text)) return parseQcschema(text, name);
  if (/Entering Gaussian System|Gaussian, Inc\.|Gaussian \d+:|^\s*(?:Standard|Input|Z-Matrix) orientation:/m.test(text)) return parseGaussianLog(text);
  if (/\[Molden Format\]/i.test(text)) return parseMolden(text);
  if (/\$vibrational_frequencies\b/.test(text)) return parseHessian(text);
  if (/CARTESIAN COORDINATES \(ANGSTROEM\)/.test(text)) return parseOrca(name, text);
  throw new Error("Supported scientific inputs are ORCA output/Hessian, Molden, Gaussian log/FCHK/cube, QCSchema and XYZ trajectories.");
}

function parseXyzTrajectory(text: string): ScientificDocument {
  const lines = text.replace(/\r/g, "").split("\n");
  const frames: ScientificFrame[] = [];
  let offset = 0;
  while (offset < lines.length) {
    if (!lines[offset].trim()) { offset++; continue; }
    const count = integer(lines[offset].trim(), MAX_ATOMS);
    if (offset + count + 1 >= lines.length) throw new Error("Truncated XYZ trajectory.");
    const block = lines.slice(offset, offset + count + 2).join("\n");
    const comment = lines[offset + 1];
    const extended = parseExtendedFrame(comment, lines.slice(offset + 2, offset + count + 2));
    frames.push(extended ?? { atoms: parseXyz(block).atoms, comment, ...trajectoryMetadata(comment) });
    if (frames.length > MAX_FRAMES) throw new Error("XYZ trajectory exceeds 2000 frames.");
    offset += count + 2;
  }
  checkFrames(frames);
  return { ...empty("xyz", frames[0].atoms), frames };
}

function parseOrca(name: string, text: string): ScientificDocument {
  text = text.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const frames: ScientificFrame[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/CARTESIAN COORDINATES \(ANGSTROEM\)/.test(lines[i])) {
      const atoms: MolecularAtom[] = [];
      while (++i < lines.length && (!lines[i].trim() || /^\s*-+\s*$/.test(lines[i]))) { /* header */ }
      for (; i < lines.length; i++) {
        const parts = fields(lines[i]);
        if (parts.length !== 4 || !/^[A-Z][a-z]?$/.test(parts[0])) break;
        atoms.push(atom(parts[0], parts.slice(1)));
        if (atoms.length > MAX_ATOMS) throw new Error("ORCA geometry exceeds atom limit.");
      }
      if (!atoms.length) throw new Error("ORCA coordinate block has no atoms.");
      frames.push({ atoms });
      if (frames.length > MAX_FRAMES) throw new Error("ORCA output exceeds frame limit.");
    }
    const energy = lines[i]?.match(/FINAL SINGLE POINT ENERGY\s+([^\s]+)/);
    if (energy && frames.length) frames[frames.length - 1].energyHartree = number(energy[1]);
  }
  checkFrames(frames);
  const result = { ...empty("orca", frames.at(-1)!.atoms), frames };
  const orbitalStart = text.lastIndexOf("ORBITAL ENERGIES");
  if (orbitalStart >= 0) {
    let spin: MolecularOrbital["spin"] = "alpha";
    let reading = false;
    for (const line of text.slice(orbitalStart).split("\n")) {
      if (/SPIN DOWN ORBITALS/.test(line)) spin = "beta";
      if (/NO\s+OCC\s+E\(Eh\)/.test(line)) { reading = true; continue; }
      const match = reading && line.match(/^\s*(\d+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(\S+))?\s*$/);
      if (match) {
        result.orbitals.push({ index: result.orbitals.length, occupancy: number(match[2]), energyHartree: number(match[3]), spin, symmetry: match[5], coefficients: [] });
        if (result.orbitals.length > 10_000) throw new Error("ORCA orbital table exceeds browser limit.");
      } else if (line.trim() && reading) reading = false;
    }
  }
  result.converged = /THE OPTIMIZATION HAS CONVERGED/.test(text) ? true
    : /THE OPTIMIZATION HAS NOT CONVERGED|SCF NOT CONVERGED/.test(text) ? false : undefined;
  // A scan/optimization output may contain a frequency calculation at several
  // geometries. Associate each block with its preceding coordinate block, not
  // with whichever geometry happened to be printed last in the file.
  const geometries = [...text.matchAll(/CARTESIAN COORDINATES \(ANGSTROEM\)/g)];
  const frequencies = [...text.matchAll(/VIBRATIONAL FREQUENCIES/g)];
  const vcdTables: Array<OrcaSourceSpectrum | undefined> = new Array(frames.length);
  let frameIndex = -1;
  let modeValues = 0;
  frequencies.forEach((frequency, i) => {
    while (frameIndex + 1 < geometries.length && geometries[frameIndex + 1].index! < frequency.index!) frameIndex++;
    if (frameIndex < 0 || !frames[frameIndex]) throw new Error("ORCA frequencies have no associated geometry.");
    const end = Math.min(frequencies[i + 1]?.index ?? text.length, geometries[frameIndex + 1]?.index ?? text.length);
    const modes = parseOrcaModes(text.slice(frequency.index, end), frames[frameIndex].atoms.length);
    modeValues += modes.reduce((sum, mode) => sum + (mode.displacements?.length ?? 0) * 3, 0);
    if (modeValues > MAX_MODE_VALUES) throw new Error("ORCA frame normal modes exceed browser limit.");
    frames[frameIndex].modes = modes;
    // A later frequency set, including one without VCD, replaces this frame's set.
    const vcd = readOrcaVcdTables(text.slice(frequency.index, end), modes).at(-1);
    vcdTables[frameIndex] = vcd ? { start: frequency.index! + vcd.start, spectrum: vcd.spectrum } : undefined;
  });
  result.modes = frames.at(-1)!.modes ?? [];
  result.frames = withOrcaSourceSpectra(name, text, frames, geometries.map(geometry => geometry.index!), vcdTables);
  return validateParsedSpectra(result);
}

function parseOrcaModes(vibrationText: string, atomCount: number): VibrationalMode[] {
  const frequencySection = vibrationText.split("NORMAL MODES")[0];
  const modes = new Map<number, VibrationalMode>();
  for (const match of frequencySection.matchAll(/^\s*(\d+):\s*([+\-\d.EeDd]+)\s*cm\*\*-1([^\n]*)/gm)) {
    const index = integer(match[1], 3 * atomCount - 1, true);
    if (modes.has(index)) throw new Error("Duplicate ORCA frequency index.");
    // ORCA 6 prints an ordinal-irrep token (for example 1-Au), not a unit.
    const symmetry = match[3].trim().match(/^(?:\d+-)?([A-Za-z][A-Za-z0-9'"′″]*(?:\(\d+\))?)\s*$/)?.[1];
    modes.set(index, { index, frequencyCm1: number(match[2]), ...(symmetry ? { symmetry } : {}) });
  }
  if (modes.size > 3 * atomCount) throw new Error("ORCA mode count exceeds geometry dimensions.");
  const normalSection = vibrationText.split("NORMAL MODES")[1]?.split(/IR SPECTRUM|RAMAN SPECTRUM|THERMOCHEMISTRY/)[0];
  if (normalSection) readModeMatrix(normalSection.split("\n"), atomCount, modes);
  const irSection = vibrationText.split("IR SPECTRUM")[1]?.split(/THERMOCHEMISTRY|RAMAN SPECTRUM/)[0];
  if (irSection) {
    const header = irSection.split("\n").find(line => /Mode\s+freq/.test(line)) ?? "";
    const hasIntensity = /Int\s*\(/i.test(header) || /km\/mol/i.test(irSection.slice(0, 500));
    const hasEpsilon = /\beps\b/i.test(header);
    const seen = new Set<number>();
    for (const line of irSection.split("\n")) {
      const match = line.match(/^\s*(\d+):\s+(.*)$/);
      if (!match) {
        if (/^\s*\d+:/.test(line)) throw new Error("Malformed ORCA IR row.");
        continue;
      }
      const index = Number(match[1]);
      const mode = modes.get(index);
      if (!mode || seen.has(index)) throw new Error("Invalid or duplicate ORCA IR mode index.");
      const values = fields(match[2]);
      if (Math.abs(number(values[0]) - mode.frequencyCm1) > 0.02) throw new Error("Mismatched ORCA IR frequency.");
      const strength = number(values[hasIntensity && hasEpsilon ? 2 : 1]);
      if (strength < 0) throw new Error("Negative ORCA IR strength.");
      seen.add(index);
      if (hasIntensity) mode.intensityKmMol = strength;
      else if (/T\*\*2/.test(header)) mode.transitionDipoleSquared = strength;
    }
  }
  const ramanSection = vibrationText.split("RAMAN SPECTRUM")[1];
  if (ramanSection) {
    // ORCA prints frequency, activity (A^4/amu), and dimensionless depolarization.
    // Read only the contiguous table after its named header, never later output.
    const lines = ramanSection.split("\n");
    const header = lines.findIndex(line => /Mode\s+freq\s*\(cm\*\*-1\)\s+Activity\s+Depolarization/.test(line));
    if (header < 0) throw new Error("Unsupported ORCA Raman table header.");
    const seen = new Set<number>();
    for (const line of lines.slice(header + 1)) {
      if (!line.trim() || /^\s*-+\s*$/.test(line)) {
        if (seen.size) break;
        continue;
      }
      const match = line.match(/^\s*(\d+):\s+(\S+)\s+(\S+)\s+(\S+)\s*$/);
      if (!match) {
        if (/^\s*\d+:/.test(line)) throw new Error("Malformed ORCA Raman row.");
        break;
      }
      const index = Number(match[1]);
      const mode = modes.get(index);
      if (!mode || seen.has(index)) throw new Error("Invalid or duplicate ORCA Raman mode index.");
      const frequency = number(match[2]);
      const activity = number(match[3]);
      const ratio = number(match[4]);
      if (Math.abs(frequency - mode.frequencyCm1) > 0.02 || activity < 0 || ratio < 0 || ratio > 1) {
        throw new Error("Invalid ORCA Raman values or mismatched frequency.");
      }
      seen.add(index);
      mode.ramanActivityAngstrom4Amu = activity;
      mode.ramanDepolarizationRatio = ratio;
    }
  }
  return [...modes.values()];
}

function readModeMatrix(lines: string[], atomCount: number, modes: Map<number, VibrationalMode>) {
  const rowCount = 3 * atomCount;
  if (rowCount * modes.size > MAX_MODE_VALUES) throw new Error("Normal-mode matrix exceeds browser limit.");
  const matrix = new Map<number, Map<number, number>>();
  let columns: number[] = [];
  for (const line of lines) {
    const parts = fields(line);
    if (parts.length && parts.every(part => /^\d+$/.test(part))) { columns = parts.map(Number); continue; }
    if (!columns.length || !/^\d+$/.test(parts[0]) || parts.length !== columns.length + 1) continue;
    const row = integer(parts[0], rowCount - 1, true);
    columns.forEach((column, i) => {
      if (!modes.has(column)) return;
      const entries = matrix.get(column) ?? new Map<number, number>();
      if (entries.has(row)) throw new Error("Duplicate normal-mode matrix entry.");
      entries.set(row, number(parts[i + 1]));
      matrix.set(column, entries);
    });
  }
  for (const [column, rows] of matrix) {
    if (rows.size !== rowCount) throw new Error("Truncated normal-mode displacement matrix.");
    modes.get(column)!.displacements = Array.from({ length: atomCount }, (_, i) => [rows.get(i * 3)!, rows.get(i * 3 + 1)!, rows.get(i * 3 + 2)!]);
  }
}

function parseHessian(text: string): ScientificDocument {
  const sections = new Map<string, string[]>();
  let current: string[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const header = line.trim().match(/^\$(\w+)/);
    if (header) {
      if (sections.has(header[1])) throw new Error(`Duplicate ORCA Hessian section: ${header[1]}.`);
      current = []; sections.set(header[1], current);
    }
    else if (line.trim() && !line.trim().startsWith("#")) current.push(line.trim());
  }
  const atomLines = sections.get("atoms");
  if (!atomLines) throw new Error("ORCA Hessian has no atoms section.");
  const count = integer(atomLines[0], MAX_ATOMS);
  if (atomLines.length !== count + 1) throw new Error("Truncated ORCA Hessian atoms.");
  const atomFields = atomLines.slice(1).map(fields);
  const atoms = atomFields.map(p => atom(p[0], p.slice(2), BOHR_ANGSTROM));
  const result = empty("orca-hessian", atoms);
  // `$atoms` rows are element, mass (amu) and position (bohr); `$hessian` is in Hartree/bohr².
  const hessian = sections.get("hessian");
  if (hessian) result.frames[0].hessian = hessianFromOrcaSection(hessian, count, atomFields.map(p => number(p[1])));
  const frequencies = sections.get("vibrational_frequencies");
  if (!frequencies) throw new Error("ORCA Hessian has no frequencies.");
  const modeCount = integer(frequencies[0], 3 * count);
  if (frequencies.length !== modeCount + 1) throw new Error("Truncated ORCA Hessian frequencies.");
  const modes = new Map<number, VibrationalMode>();
  frequencies.slice(1).forEach(line => {
    const p = fields(line);
    if (p.length !== 2) throw new Error("Malformed ORCA Hessian frequency row.");
    const index = integer(p[0], modeCount - 1, true);
    if (modes.has(index)) throw new Error("Duplicate normal mode index.");
    modes.set(index, { index, frequencyCm1: number(p[1]) });
  });
  const normalModes = sections.get("normal_modes");
  if (normalModes) {
    const dimension = fields(normalModes[0]);
    if (integer(dimension[0], 3 * count) !== 3 * count || integer(dimension[1], modeCount) !== modeCount) throw new Error("Normal-mode matrix dimensions do not match atoms/frequencies.");
    readModeMatrix(normalModes.slice(1), count, modes);
    if ([...modes.values()].some(mode => !mode.displacements)) throw new Error("Incomplete ORCA Hessian normal modes.");
  }
  // Hessian spectra have no mode-index column: row n belongs to mode n,
  // including zero-frequency translation/rotation rows. ORCA 3's five-column
  // IR table is wavenumber, T**2, TX, TY, TZ (atomic units), not km/mol.
  // Reference: opan/test/resource/orca/test_orca_v3.0.3.hess and
  // opan/test/orca_hess.py in https://github.com/bskinn/opan.
  for (const name of ["ir_spectrum", "raman_spectrum"] as const) {
    const rows = sections.get(name);
    if (!rows) continue;
    if (integer(rows[0], modeCount) !== modeCount || rows.length !== modeCount + 1) {
      throw new Error(`ORCA Hessian ${name} dimensions do not match frequencies.`);
    }
    rows.slice(1).forEach((line, index) => {
      const p = fields(line);
      const expected = name === "ir_spectrum" ? 5 : 3;
      if (p.length !== expected) throw new Error(`Unsupported ORCA Hessian ${name} row layout.`);
      const values = p.map(number);
      const mode = modes.get(index)!;
      if (Math.abs(values[0] - mode.frequencyCm1) > 0.02 || values[1] < 0) {
        throw new Error(`Invalid ORCA Hessian ${name} values or mismatched frequency.`);
      }
      if (name === "ir_spectrum") {
        mode.transitionDipoleSquared = values[1];
      } else {
        if (values[2] < 0 || values[2] > 1) throw new Error("Invalid ORCA Hessian Raman depolarization ratio.");
        mode.ramanActivityAngstrom4Amu = values[1];
        mode.ramanDepolarizationRatio = values[2];
      }
    });
  }
  result.modes = [...modes.values()];
  result.frames[0].modes = result.modes;
  return result;
}

function parseCube(text: string): ScientificDocument {
  const lines = text.replace(/\r/g, "").split("\n");
  const header = fields(lines[2] ?? "");
  const signedAtoms = number(header[0]);
  if (!Number.isInteger(signedAtoms) || signedAtoms < 1) throw new Error("Multi-orbital and atom-free cube files are not supported; export one scalar field.");
  const count = integer(header[0], MAX_ATOMS);
  if (header[4] && number(header[4]) !== 1) throw new Error("Multi-field cube files are not supported.");
  const axisLines = lines.slice(3, 6).map(fields);
  if (axisLines.length !== 3) throw new Error("Cube grid header is incomplete.");
  const signs = axisLines.map(parts => Math.sign(number(parts[0])));
  if (signs.some(sign => sign !== signs[0])) throw new Error("Mixed cube axis units are unsupported.");
  const scale = signs[0] < 0 ? 1 : BOHR_ANGSTROM;
  const dimensions = axisLines.map(p => integer(String(Math.abs(number(p[0]))), MAX_GRID)) as ScalarGrid["dimensions"];
  const size = dimensions.reduce((a, b) => a * b, 1);
  if (size > MAX_GRID) throw new Error("Cube grid exceeds one million values.");
  const origin = header.slice(1, 4).map(v => number(v) * scale) as Vec3;
  const axes = axisLines.map(p => p.slice(1, 4).map(v => number(v) * scale)) as ScalarGrid["axes"];
  validateGridGeometry(dimensions, origin, axes);
  const atoms = lines.slice(6, 6 + count).map(line => { const p = fields(line); return atom(elementSymbol(integer(p[0], 118)), p.slice(2), scale); });
  const tokens = lines.slice(6 + count).join(" ").trim().split(/\s+/);
  if (tokens.length !== size) throw new Error("Cube data length does not match its dimensions.");
  const values = new Float32Array(tokens.map(number));
  if (values.some(value => !Number.isFinite(value))) throw new Error("Cube values exceed float range.");
  return { ...empty("cube", atoms), grid: { dimensions, origin, axes, values } };
}

function validateGridGeometry(dimensions: ScalarGrid["dimensions"], origin: Vec3, axes: ScalarGrid["axes"]) {
  if (origin.length !== 3 || axes.length !== 3 || axes.some(axis => axis.length !== 3)) throw new Error("Cube vectors are incomplete.");
  if ([...origin, ...axes.flat()].some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) throw new Error("Cube coordinates exceed the browser limit of one million angstrom.");
  const [a, b, c] = axes;
  const determinant = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-15) throw new Error("Cube axes must span a finite nonzero volume.");
  // All eight corners are needed: opposing nonorthogonal axes can cancel at the far corner.
  for (let corner = 0; corner < 8; corner++) for (let component = 0; component < 3; component++) {
    let position = origin[component];
    for (let axis = 0; axis < 3; axis++) if (corner & (1 << axis)) position += axes[axis][component] * (dimensions[axis] - 1);
    if (!Number.isFinite(position) || Math.abs(position) > 1e6) throw new Error("Cube grid corners exceed the browser coordinate limit.");
  }
}

export function scientificFrameToXyz(frame: ScientificFrame): string {
  return serializeXyz(frame.atoms, frame.energyHartree === undefined ? frame.comment ?? "" : `Energy=${frame.energyHartree} Hartree`);
}

export function displaceNormalMode(atoms: MolecularAtom[], mode: VibrationalMode, amplitude: number, phase: number): MolecularAtom[] {
  if (!mode.displacements || mode.displacements.length !== atoms.length) throw new Error("This mode has no complete displacement vectors.");
  if (!Number.isFinite(amplitude) || amplitude < 0 || amplitude > 5 || !Number.isFinite(phase)) throw new Error("Invalid vibration amplitude or phase.");
  const maximum = Math.max(...mode.displacements.map(v => Math.hypot(...v)));
  const scale = maximum > 0 ? amplitude * Math.sin(phase) / maximum : 0;
  return atoms.map((item, i) => ({ ...item, x: item.x + scale * mode.displacements![i][0], y: item.y + scale * mode.displacements![i][1], z: item.z + scale * mode.displacements![i][2] }));
}

export function gridToCube(grid: ScalarGrid, atoms: MolecularAtom[]): string {
  const { dimensions, origin, axes, values } = grid;
  if (dimensions.length !== 3 || dimensions.some(value => !Number.isInteger(value) || value < 1) || dimensions.reduce((a, b) => a * b, 1) !== values.length || values.length > MAX_GRID) throw new Error("Invalid scalar grid dimensions.");
  validateGridGeometry(dimensions, origin, axes);
  if ([...origin, ...axes.flat()].some(value => !Number.isFinite(value)) || values.some(value => !Number.isFinite(value))) throw new Error("Scalar grid values must be finite.");
  const vector = (v: Vec3) => v.map(value => (value / BOHR_ANGSTROM).toExponential(9)).join(" ");
  const lines = ["Burette scalar field", "Coordinates in bohr; z index varies fastest", `${atoms.length} ${vector(origin)}`];
  dimensions.forEach((dimension, i) => lines.push(`${dimension} ${vector(axes[i])}`));
  atoms.forEach(item => lines.push(`${atomicNumber(item.element)} 0 ${vector([item.x, item.y, item.z])}`));
  for (let i = 0; i < values.length; i += 6) lines.push(Array.from(values.slice(i, i + 6), value => value.toExponential(7)).join(" "));
  return lines.join("\n") + "\n";
}

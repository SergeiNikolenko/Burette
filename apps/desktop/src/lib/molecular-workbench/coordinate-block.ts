// Cartesian/lattice/Z-matrix coordinate blocks, adapted from Avogadro's
// CoordinateBlockGenerator and Cartesian Coordinate Editor (avogadrolibs
// 064eeb4706877ffed8ddc4b037489ed3748b0547, BSD-3-Clause; see THIRD_PARTY_NOTICES.md).
// Z-matrix rows are Burette's own: atom order is kept and references come from
// the existing internal-coordinate code, never from a second implementation.
import {
  MAX_INTERNAL_COORDINATE_ATOMS,
  atomsFromZmatrixRows,
  placeInReferenceFrame,
  zmatrixRowsFromAtoms,
  type ZmatrixRow,
} from "../../../../../scripts/internal-coordinates.mjs";
import { ELEMENT_SYMBOLS } from "./elements";
import type { MolecularAtom, UnitCell, Vec3 } from "./types";

/** Avogadro's `BOHR_TO_ANGSTROM_D`: the CODATA 2022 Bohr radius, 0.529177210544(82) Å. */
export const BOHR_TO_ANGSTROM = 0.529177210544;
export const MAX_COORDINATE_BLOCK_BYTES = 1024 * 1024;
const MAX_COORDINATE = 1e6;

export type CoordinateUnit = "angstrom" | "bohr";
/** Avogadro's `Mode`: one Cartesian line per atom, or a ragged or zero-padded Z-matrix. */
export type CoordinateBlockMode = "cartesian" | "zmatrix" | "zmatrix-padded";
export type CoordinateBlockFormat = { spec: string; mode: CoordinateBlockMode; unit: CoordinateUnit; cell?: UnitCell | null };
export type CoordinatePreset = { id: string; label: string; spec: string; mode: CoordinateBlockMode; unit?: CoordinateUnit; lattice?: true };
/** `line` is 1-based in the edited text; null for the whole block. */
export type CoordinateBlockError = { line: number | null; message: string };
export type CoordinateBlockParse = { atoms: MolecularAtom[]; errors: CoordinateBlockError[] };

export const CUSTOM_COORDINATE_SPEC = "SZxyz#N";
/**
 * Avogadro's editor presets first (same labels and specifications), then the
 * coordinate blocks of the Avogadro input generators (OpenChemistry/avogenerators
 * 965ea6302b930cfc34b0b2deefdab5737bfe15c0). Turbomole's coord file is in bohr.
 */
export const COORDINATE_PRESETS: readonly CoordinatePreset[] = [
  { id: "xyz-symbols", label: "XYZ format (symbols)", spec: "Sxyz", mode: "cartesian" },
  { id: "xyz-names", label: "XYZ format (names)", spec: "Nxyz", mode: "cartesian" },
  { id: "xyz-numbers", label: "XYZ format (atomic numbers)", spec: "Zxyz", mode: "cartesian" },
  { id: "lattice-symbols", label: "Lattice coordinates (symbols)", spec: "Sabc", mode: "cartesian", lattice: true },
  { id: "lattice-names", label: "Lattice coordinates (names)", spec: "Nabc", mode: "cartesian", lattice: true },
  { id: "lattice-numbers", label: "Lattice coordinates (atomic numbers)", spec: "Zabc", mode: "cartesian", lattice: true },
  { id: "gamess-symbols", label: "GAMESS format (symbols)", spec: "SGxyz", mode: "cartesian" },
  { id: "gamess-names", label: "GAMESS format (names)", spec: "NGxyz", mode: "cartesian" },
  { id: "turbomole", label: "Turbomole format", spec: "xyzS", mode: "cartesian", unit: "bohr" },
  { id: "gaussian-cartesian", label: "Gaussian Cartesian", spec: "Sxyz", mode: "cartesian" },
  { id: "gaussian-zmatrix", label: "Gaussian Z-matrix", spec: "_S_I_R_J_A_K_T", mode: "zmatrix" },
  { id: "mopac-cartesian", label: "MOPAC Cartesian", spec: "Sx1y1z1", mode: "cartesian" },
  { id: "mopac-zmatrix", label: "MOPAC Z-matrix", spec: "_S_R_1_A_1_T_1_I_J_K", mode: "zmatrix-padded" },
  { id: "orca-cartesian", label: "ORCA Cartesian", spec: "____Sxyz", mode: "cartesian" },
  { id: "orca-internal", label: "ORCA internal", spec: "____S_I_J_K_R_A_T", mode: "zmatrix-padded" },
  { id: "psi4-cartesian", label: "Psi4 Cartesian", spec: "___Sxyz", mode: "cartesian" },
  { id: "psi4-zmatrix", label: "Psi4 Z-matrix", spec: "___S_I_R_J_A_K_T", mode: "zmatrix" },
  { id: "molpro-zmatrix", label: "Molpro Z-matrix", spec: "S,I,R,J,A,K,T", mode: "zmatrix" },
  { id: "gamess-uk", label: "GAMESS-UK Cartesian", spec: "_xyzZS", mode: "cartesian" },
];

// Avogadro's element names, index = atomic number (0 is its dummy element).
const ELEMENT_NAMES = ("Dummy Hydrogen Helium Lithium Beryllium Boron Carbon Nitrogen Oxygen Fluorine Neon Sodium Magnesium Aluminium Silicon Phosphorus Sulfur Chlorine Argon "
  + "Potassium Calcium Scandium Titanium Vanadium Chromium Manganese Iron Cobalt Nickel Copper Zinc Gallium Germanium Arsenic Selenium Bromine Krypton Rubidium Strontium Yttrium "
  + "Zirconium Niobium Molybdenum Technetium Ruthenium Rhodium Palladium Silver Cadmium Indium Tin Antimony Tellurium Iodine Xenon Caesium Barium Lanthanum Cerium Praseodymium "
  + "Neodymium Promethium Samarium Europium Gadolinium Terbium Dysprosium Holmium Erbium Thulium Ytterbium Lutetium Hafnium Tantalum Tungsten Rhenium Osmium Iridium Platinum Gold "
  + "Mercury Thallium Lead Bismuth Polonium Astatine Radon Francium Radium Actinium Thorium Protactinium Uranium Neptunium Plutonium Americium Curium Berkelium Californium Einsteinium "
  + "Fermium Mendelevium Nobelium Lawrencium Rutherfordium Dubnium Seaborgium Bohrium Hassium Meitnerium Darmstadtium Roentgenium Copernicium Nihonium Flerovium Moscovium Livermorium "
  + "Tennessine Oganesson").split(" ");
const SYMBOLS = ["Xx", ...ELEMENT_SYMBOLS];
// Avogadro's fixed widths and precisions.
const COORDINATE_WIDTH = 11, COORDINATE_PRECISION = 6;
const CARTESIAN_SPEC = new Set("#ZGSLNabcxyz01_,");
const ZMATRIX_SPEC = new Set([...CARTESIAN_SPEC, ..."IJKRAT"]);
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u;
const INTEGER = /^[+-]?\d+$/u;
const TOKEN = /[^\s,;]+/gu;

const cleanToken = (token: string) => token ? token[0].toUpperCase() + token.slice(1).toLowerCase() : token;
const indexWidth = (count: number) => count > 0 ? Math.floor(Math.log10(count)) + 1 : 1;
// std::fixed prints the sign of negative zero.
const fixed = (value: number, digits: number) => (Object.is(value, -0) ? "-" : "") + value.toFixed(digits);
const coordinate = (value: number) => fixed(value, COORDINATE_PRECISION).padStart(COORDINATE_WIDTH);
const atomicNumberOf = (element: string) => {
  const number = ELEMENT_SYMBOLS.indexOf(element) + 1;
  if (!number) throw new Error(`Unknown element: ${element}`);
  return number;
};

/** Rows 0, 1, 2 have no I/R, J/A, K/T fields respectively. */
function fieldMissing(char: string, row: number) {
  if (char === "I" || char === "R") return row < 1;
  if (char === "J" || char === "A") return row < 2;
  if (char === "K" || char === "T") return row < 3;
  return false;
}

function unknownSpecError(spec: string, mode: CoordinateBlockMode) {
  const allowed = mode === "cartesian" ? CARTESIAN_SPEC : ZMATRIX_SPEC;
  const unknown = [...spec].find(char => !allowed.has(char));
  if (!unknown) return null;
  return mode === "cartesian" && ZMATRIX_SPEC.has(unknown) ? `“${unknown}” belongs to a Z-matrix format.` : `“${unknown}” is not a format character.`;
}

/** Why edited text cannot be read with this specification, or null. An empty one is detected. */
export function coordinateSpecError(spec: string, mode: CoordinateBlockMode): string | null {
  const unknown = unknownSpecError(spec, mode);
  if (unknown || !spec) return unknown;
  if (![..."SNLZG"].some(char => spec.includes(char))) return "The format needs an element: S, N, L, Z or G.";
  if (mode === "cartesian") {
    const cartesian = [..."xyz"].every(char => spec.includes(char)), lattice = [..."abc"].every(char => spec.includes(char));
    if (cartesian === lattice) return "The format needs x, y and z, or a, b and c.";
  } else if (![..."IJKRAT"].every(char => spec.includes(char))) return "A Z-matrix format needs I, J, K, R, A and T.";
  return null;
}

function toFractional(cell: UnitCell, [x, y, z]: Vec3): Vec3 {
  const [a, b, c] = cell;
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  // Solve x·(row vectors) by Cramer's rule: r = f_a a + f_b b + f_c c.
  const solve = (u: Vec3, v: Vec3, w: Vec3) => (u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0])) / det;
  const r: Vec3 = [x, y, z];
  return [solve(r, b, c), solve(a, r, c), solve(a, b, r)];
}
const toCartesian = (cell: UnitCell, f: Vec3): Vec3 => [0, 1, 2].map(axis => f[0] * cell[0][axis] + f[1] * cell[1][axis] + f[2] * cell[2][axis]) as Vec3;

/**
 * The coordinate block for `atoms` (angstrom), as Avogadro writes it: fixed widths,
 * six decimals, a space between fields except around commas. Lattice fields without a
 * cell print N/A. Throws for an unknown format character or a Z-matrix the atoms cannot form.
 */
export function generateCoordinateBlock(atoms: readonly MolecularAtom[], format: CoordinateBlockFormat): string {
  const { spec, mode, unit, cell = null } = format;
  const error = unknownSpecError(spec, mode);
  if (error) throw new Error(error);
  if (atoms.length > MAX_INTERNAL_COORDINATE_ATOMS) throw new Error(`The coordinate editor supports up to ${MAX_INTERNAL_COORDINATE_ATOMS} atoms.`);
  const scale = unit === "bohr" ? 1 / BOHR_TO_ANGSTROM : 1;
  const rows: ZmatrixRow[] | null = mode === "cartesian" ? null : zmatrixRowsFromAtoms(atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] })));
  const width = indexWidth(atoms.length);
  const counts = new Map<number, number>();
  let out = "";
  atoms.forEach((atom, index) => {
    const number = atomicNumberOf(atom.element);
    counts.set(number, (counts.get(number) ?? 0) + 1);
    const row = rows?.[index];
    const fractional = cell ? toFractional(cell, [atom.x, atom.y, atom.z]) : null;
    // A ragged Z-matrix drops the fields an opening row lacks and the separator before each.
    const keep = [...spec].map(char => mode !== "zmatrix" || !fieldMissing(char, index));
    for (let i = spec.length - 1; i >= 1; i--) {
      if (mode === "zmatrix" && fieldMissing(spec[i], index) && (spec[i - 1] === "_" || spec[i - 1] === ",")) keep[i - 1] = false;
    }
    for (let i = 0; i < spec.length; i++) {
      if (!keep[i]) continue;
      let next = i + 1;
      while (next < spec.length && !keep[next]) next++;
      const haveNext = next < spec.length, char = spec[i];
      const reference = (slot: number) => row && slot < row.refs.length ? row.refs[slot] + 1 : 0;
      const value = (slot: number) => row && slot < row.values.length ? row.values[slot] : 0;
      switch (char) {
        case "_": if (!haveNext) out += " "; break;
        case ",": out += ","; break;
        case "#": out += String(index + 1).padEnd(width); break;
        case "Z": out += String(number).padEnd(3); break;
        case "G": out += number.toFixed(1).padStart(5); break;
        case "S": out += atom.element.padEnd(3); break;
        case "L": out += `${atom.element}${counts.get(number)} `; break;
        case "N": out += ELEMENT_NAMES[number].padEnd(13); break;
        case "x": out += coordinate(atom.x * scale); break;
        case "y": out += coordinate(atom.y * scale); break;
        case "z": out += coordinate(atom.z * scale); break;
        case "a": case "b": case "c":
          out += fractional ? coordinate(fractional["abc".indexOf(char)]) : "N/A".padStart(COORDINATE_WIDTH); break;
        case "0": case "1": out += char; break;
        case "I": case "J": case "K": out += String(reference("IJK".indexOf(char))).padStart(width); break;
        case "R": out += coordinate(value(0) * scale); break;
        case "A": case "T": out += coordinate(value("RAT".indexOf(char))); break;
      }
      if (!haveNext) out += "\n";
      else if (char !== "," && spec[next] !== ",") out += " ";
    }
    // A row whose every field was dropped still occupies its line.
    if (spec.length && !keep.some(Boolean)) out += "\n";
  });
  return out;
}

/**
 * Avogadro's guess of a Cartesian specification from one sample line, used when the
 * format is empty: an integer within the element range or an element symbol/name
 * gives the element; the first three reals give x, y and z (integers are promoted
 * when fewer than three reals are present). Null when no element or coordinates fit.
 */
export function detectCoordinateSpec(sample: string): string | null {
  const tokens = sample.match(TOKEN) ?? [];
  const types = tokens.map(token => INTEGER.test(token) ? "int" : /^[+-]?(?:\d*\.\d*|\d+[Ee][+-]?\d+|\d*\.\d*[Ee][+-]?\d+)$/u.test(token) ? "double" : "string");
  const count = (type: string) => types.filter(item => item === type).length;
  if (count("double") < 3 && count("double") + count("int") >= 3) {
    let skip = count("int") + count("double") > 3, promote = 3 - count("double");
    for (let i = 0; i < types.length && promote > 0; i++) {
      if (types[i] !== "int") continue;
      if (skip) { skip = false; continue; }
      types[i] = "double"; promote--;
    }
  }
  if ((!count("int") && !count("string")) || count("double") < 3) return null;
  let spec = "", element = false, coordinates = 0;
  for (let i = 0; i < tokens.length && (!element || coordinates < 3); i++) {
    let char = "?";
    if (types[i] === "int" && !element) {
      const value = Number(tokens[i]);
      // Avogadro compares with its element count, which includes the dummy element.
      if (value >= 0 && value <= SYMBOLS.length) { char = "Z"; element = true; }
    } else if (types[i] === "double" && coordinates < 3) {
      char = "xyz"[coordinates++];
    } else if (types[i] === "string" && !element) {
      const clean = cleanToken(tokens[i]);
      if (clean.length <= 3 ? SYMBOLS.includes(clean) : ELEMENT_NAMES.includes(clean)) { char = clean.length <= 3 ? "S" : "N"; element = true; }
    }
    spec += char;
  }
  return element && coordinates === 3 ? spec : null;
}

type Line = { number: number; tokens: string[] };
type ParsedLine = { element: string; coordinates: Partial<Record<"x" | "y" | "z" | "a" | "b" | "c", { value: number; token: string }>>;
  refs: number[]; values: number[]; dummy: boolean };

function parseLine(line: Line, spec: string, mode: CoordinateBlockMode, row: number, fail: (message: string) => void): ParsedLine | null {
  let element: number | null = null, conflict = false, dummy = false, token = 0;
  const parsed: ParsedLine = { element: "", coordinates: {}, refs: [], values: [], dummy: false };
  const assign = (number: number) => { if (element !== null && element !== number) conflict = true; element = number; };
  for (const char of spec) {
    if (char === "_" || char === ",") continue;
    if (mode === "zmatrix" && fieldMissing(char, row)) continue;
    const text = line.tokens[token++];
    if (text === undefined) { fail("Too few entries on line."); return null; }
    const number = Number(text);
    switch (char) {
      // A detected field with nothing to validate.
      case "?": break;
      case "N": { const index = ELEMENT_NAMES.indexOf(cleanToken(text)); if (index < 1) { fail("Invalid element name."); return null; } assign(index); break; }
      case "S": {
        const clean = cleanToken(text);
        if (mode !== "cartesian" && (clean === "X" || clean === "Xx")) { dummy = true; break; }
        const index = SYMBOLS.indexOf(clean);
        if (index < 0) { fail("Invalid element symbol."); return null; }
        if (index === 0) { fail("Dummy atoms are not supported here."); return null; }
        assign(index); break;
      }
      case "L": {
        const match = /^([A-Z][a-z]?)(\d+)$/u.exec(cleanToken(text));
        if (!match) { fail("Invalid atom label."); return null; }
        const index = SYMBOLS.indexOf(match[1]);
        if (index < 1) { fail("Invalid element symbol."); return null; }
        assign(index); break;
      }
      case "Z": case "G":
        if ((char === "Z" ? !INTEGER.test(text) : !DECIMAL.test(text)) || !Number.isInteger(number) || number < 1 || number > ELEMENT_SYMBOLS.length) { fail("Invalid atomic number."); return null; }
        assign(number); break;
      case "#": if (!INTEGER.test(text)) { fail("Invalid atomic index."); return null; } break;
      case "0": case "1": if (!INTEGER.test(text)) { fail("Invalid optimization flag."); return null; } break;
      case "x": case "y": case "z": case "a": case "b": case "c":
        if (!DECIMAL.test(text) || !Number.isFinite(number)) { fail("Invalid coordinate."); return null; }
        parsed.coordinates[char] = { value: number, token: text }; break;
      case "I": case "J": case "K": {
        const slot = "IJK".indexOf(char);
        if (!INTEGER.test(text)) { fail("Invalid reference row."); return null; }
        if (slot < Math.min(row, 3)) parsed.refs[slot] = number - 1;
        break;
      }
      case "R": case "A": case "T": {
        const slot = "RAT".indexOf(char);
        if (!DECIMAL.test(text) || !Number.isFinite(number)) { fail(char === "R" ? "Invalid distance." : char === "A" ? "Invalid angle." : "Invalid dihedral."); return null; }
        if (slot < Math.min(row, 3)) parsed.values[slot] = number;
        break;
      }
    }
  }
  if (conflict) { fail("The element fields on this line disagree."); return null; }
  if (dummy) return { ...parsed, element: "X", dummy: true };
  return { ...parsed, element: ELEMENT_SYMBOLS[element! - 1] };
}

/**
 * Atoms (angstrom) read from edited text with the same specification, or one error per
 * invalid line. Blank lines are skipped and extra trailing fields ignored, as Avogadro
 * does; an empty specification is detected from the first line. With `reference`
 * atoms in the same order, any Cartesian field still showing the generated text keeps
 * the exact reference value, and a Z-matrix is placed in the reference orientation.
 */
export function parseCoordinateBlock(text: string, format: CoordinateBlockFormat & { reference?: readonly MolecularAtom[] }): CoordinateBlockParse {
  const { mode, unit, cell = null, reference } = format;
  const empty: CoordinateBlockParse = { atoms: [], errors: [] };
  if (text.length > MAX_COORDINATE_BLOCK_BYTES || new TextEncoder().encode(text).byteLength > MAX_COORDINATE_BLOCK_BYTES) return { ...empty, errors: [{ line: null, message: "The coordinates exceed 1 MiB." }] };
  if (text.includes("\0")) return { ...empty, errors: [{ line: null, message: "The coordinates contain binary data." }] };
  const lines: Line[] = text.split(/\r\n|\r|\n/u).flatMap((value, index) => {
    const tokens = value.match(TOKEN) ?? [];
    return tokens.length ? [{ number: index + 1, tokens }] : [];
  });
  if (!lines.length) return empty;
  if (lines.length > MAX_INTERNAL_COORDINATE_ATOMS) return { ...empty, errors: [{ line: null, message: `The coordinate editor supports up to ${MAX_INTERNAL_COORDINATE_ATOMS} atoms.` }] };
  let spec = format.spec;
  if (!spec) {
    const detected = mode === "cartesian" ? detectCoordinateSpec(lines[0].tokens.join(" ")) : null;
    if (!detected) return { ...empty, errors: [{ line: lines[0].number, message: "Could not recognize the coordinate format." }] };
    spec = detected;
  }
  const specError = coordinateSpecError(spec.replace(/\?/gu, ""), mode);
  if (specError) return { ...empty, errors: [{ line: null, message: specError }] };
  const lattice = spec.includes("a");
  if (lattice && !cell) return { ...empty, errors: [{ line: null, message: "Fractional coordinates need a unit cell." }] };
  const errors: CoordinateBlockError[] = [];
  const parsed = lines.map((line, row) => parseLine(line, spec, mode, row, message => errors.push({ line: line.number, message })));
  if (errors.length) return { atoms: [], errors };
  const rows = parsed as ParsedLine[];
  const scale = unit === "bohr" ? BOHR_TO_ANGSTROM : 1, generated = unit === "bohr" ? 1 / BOHR_TO_ANGSTROM : 1;
  const exact = (atom: number, axis: 0 | 1 | 2, field: { value: number; token: string }) => {
    const original = reference?.[atom];
    if (original && rows.length === reference.length && original.element === rows[atom].element) {
      const value = [original.x, original.y, original.z][axis];
      if (fixed(value * generated, COORDINATE_PRECISION) === field.token) return value;
    }
    return field.value * scale;
  };
  const bounded = (atoms: MolecularAtom[]) => {
    const outside = atoms.findIndex(atom => [atom.x, atom.y, atom.z].some(value => !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE));
    if (outside >= 0) return { atoms: [], errors: [{ line: lines[outside].number, message: "Coordinates must be within ±1,000,000 Å." }] };
    return { atoms, errors: [] };
  };
  if (mode === "cartesian") {
    return bounded(rows.map((row, index) => {
      const { coordinates } = row;
      if (lattice) {
        const [x, y, z] = toCartesian(cell!, [coordinates.a!.value, coordinates.b!.value, coordinates.c!.value]);
        return { element: row.element, x, y, z };
      }
      return { element: row.element, x: exact(index, 0, coordinates.x!), y: exact(index, 1, coordinates.y!), z: exact(index, 2, coordinates.z!) };
    }));
  }
  return zmatrixAtoms(rows, lines, unit, format, reference);
}

function zmatrixAtoms(rows: ParsedLine[], lines: Line[], unit: CoordinateUnit, format: CoordinateBlockFormat, reference?: readonly MolecularAtom[]): CoordinateBlockParse {
  const errors: CoordinateBlockError[] = [];
  const definition: ZmatrixRow[] = rows.map((row, index) => {
    const arity = Math.min(index, 3);
    const refs = row.refs.slice(0, arity), values = row.values.slice(0, arity);
    if (refs.some((ref, slot) => ref < 0 || ref >= index || refs.indexOf(ref) !== slot)) errors.push({ line: lines[index].number, message: "References must be distinct earlier rows." });
    if (values[0] !== undefined) values[0] *= unit === "bohr" ? BOHR_TO_ANGSTROM : 1;
    // A dihedral and the same dihedral ± 360° describe one geometry (MOPAC writes 0–360).
    if (values[2] !== undefined) {
      const wrapped = ((((values[2] + 180) % 360) + 360) % 360) - 180;
      values[2] = wrapped === -180 && values[2] > 0 ? 180 : wrapped;
    }
    return { element: row.element, refs, values };
  });
  if (errors.length) return { atoms: [], errors };
  // The unchanged generated block is the reference itself, not its six-decimal rebuild.
  if (reference?.length && lines.map(line => line.tokens.join(" ")).join("\n") === blockTokens(reference, format)) return { atoms: reference.map(atom => ({ ...atom })), errors: [] };
  let placed;
  try {
    placed = atomsFromZmatrixRows(definition);
  } catch {
    // The first row whose prefix cannot be placed names the line.
    let low = 1, high = definition.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      try { atomsFromZmatrixRows(definition.slice(0, middle)); low = middle + 1; } catch { high = middle; }
    }
    let message = "This row cannot be placed.";
    try { atomsFromZmatrixRows(definition.slice(0, low)); } catch (error) { message = error instanceof Error ? error.message : message; }
    return { atoms: [], errors: [{ line: lines[low - 1].number, message }] };
  }
  const real = placed.filter((_, index) => !rows[index].dummy);
  if (!real.length) return { atoms: [], errors: [{ line: null, message: "The Z-matrix has no atoms." }] };
  const oriented = reference?.length === real.length && real.every((atom, index) => atom.element === reference[index].element)
    ? placeInReferenceFrame(real, reference.map(({ element, x, y, z }) => ({ element, position: [x, y, z] })))
    : real;
  const atoms = oriented.map(({ element, position: [x, y, z] }) => ({ element, x, y, z }));
  const outside = atoms.findIndex(atom => [atom.x, atom.y, atom.z].some(value => !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE));
  return outside < 0 ? { atoms, errors: [] } : { atoms: [], errors: [{ line: null, message: "Coordinates must be within ±1,000,000 Å." }] };
}

function blockTokens(atoms: readonly MolecularAtom[], format: CoordinateBlockFormat) {
  try {
    return generateCoordinateBlock(atoms, format).split("\n").flatMap(line => { const tokens = line.match(TOKEN); return tokens ? [tokens.join(" ")] : []; }).join("\n");
  } catch { return null; }
}

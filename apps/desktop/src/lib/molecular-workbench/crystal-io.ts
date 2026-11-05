import { parseCifText } from "@molstar/io/reader/cif/text/parser";
import type { CifBlock } from "@molstar/io/reader/cif/data-model";
import { readCifCrystal } from "./cif-crystal";
import { cartesianToFractional, readUnitCell } from "./crystal";
import { symmetryOperationXyz, type CrystalSites, type SymmetryOperation } from "./crystal-symmetry";
import { wholeMolecules } from "./periodic-bonds";
import { readPoscar, writePoscar } from "./poscar";
import type { MolecularAtom, UnitCell } from "./types";
import { parseXyz, serializeXyz } from "./xyz";

/**
 * Periodic sources the crystal tools read and write in their own format: CIF,
 * extended XYZ with a Lattice and VASP POSCAR/CONTCAR. Reading yields the full
 * P1 cell; writing keeps atom order exactly.
 */

export type CrystalFormat = "cif" | "xyz" | "vasp";
export type CrystalSource = { format: CrystalFormat; text: string };

// Small-molecule CIF lists fractional sites (DDL1 `_atom_site_fract_x` or DDLm
// `_atom_site.fract_x`); macromolecular mmCIF never does and keeps its own route.
const FRACTIONAL_SITES = /^\s*_atom_site[._]fract_[xyz]\b/imu;
const XYZ_LATTICE = /\bLattice\s*=\s*"/iu;

/** The crystal format of a periodic source, or null for a molecule or a macromolecular mmCIF. */
export function periodicCrystalFormat(extension: string, text: string): CrystalFormat | null {
  if (extension === "vasp") return "vasp";
  if (extension === "xyz") return XYZ_LATTICE.test(text.replace(/^\uFEFF/u, "").split(/\r?\n/u, 2)[1] ?? "") ? "xyz" : null;
  return (extension === "cif" || extension === "mcif" || extension === "mmcif") && FRACTIONAL_SITES.test(text) ? "cif" : null;
}
/** A full cell plus what its file carried that the next write should keep. */
export type CrystalDocument = CrystalSites & {
  title: string;
  /** POSCAR selective-dynamics flags, one per atom. */
  selectiveDynamics: [boolean, boolean, boolean][] | null;
};

/** CIF type symbols per atom-site row of the block readCifCrystal chose. */
async function cifTypeSymbols(text: string, header: string) {
  const parsed = await parseCifText(text).run();
  if (parsed.isError) throw new Error(`Invalid CIF: ${parsed.message}`);
  const blocks: readonly CifBlock[] = parsed.result.blocks;
  const block = blocks.find((candidate) => candidate.header === header);
  // Field lookup as readCifCrystal does it: DDL1 names are whole categories, DDLm names category.field.
  for (const name of ["atom_site_type_symbol", "atom_site.type_symbol"]) {
    const [categoryName, fieldName = ""] = name.split(".");
    const category = Object.entries(block?.categories ?? {}).find(([candidate]) => candidate.toLowerCase() === categoryName)?.[1];
    const key = category?.fieldNames.find((candidate) => candidate.toLowerCase() === fieldName);
    if (key === undefined) continue;
    const field = category!.getField(key)!;
    return Array.from({ length: field.rowCount }, (_, row) => field.str(row));
  }
  return null;
}

/** "Fe2+" stays a species of its own; "O-" and "O1-" are one species, "Fe0+" is neutral Fe. */
function speciesKey(type: string | undefined, element: string) {
  const match = type?.match(/^([A-Z][a-z]?)(\d*)([+-])?$/u);
  if (!match || !match[3]) return element;
  if (match[1] !== element) throw new Error(`CIF type symbol ${type} does not match element ${element}.`);
  const charge = Number(match[2] || "1");
  return charge === 0 ? element : `${element}${charge}${match[3]}`;
}

const numbered = (atoms: readonly MolecularAtom[]) => atoms.map((atom, index) => `${atom.element}${index + 1}`);

/**
 * Atoms of one explicit cell. CIF symmetry is expanded and partial occupancy or disorder
 * refused exactly as when the CIF opens; extended XYZ needs a single frame and a Lattice.
 */
export async function readCrystalDocument(source: CrystalSource): Promise<CrystalDocument> {
  if (source.format === "xyz") {
    let parsed;
    try {
      parsed = parseXyz(source.text);
    } catch (error) {
      throw new Error(`Crystal tools need one XYZ frame of element symbols and coordinates. ${error instanceof Error ? error.message : String(error)}`);
    }
    const cell = readUnitCell(source.text);
    if (!cell) throw new Error("This XYZ file has no Lattice in its comment line, so it has no unit cell.");
    return { atoms: parsed.atoms, cell, species: parsed.atoms.map((atom) => atom.element), labels: numbered(parsed.atoms), title: parsed.title, selectiveDynamics: null };
  }
  if (source.format === "vasp") {
    const poscar = readPoscar(source.text);
    return { atoms: poscar.atoms, cell: poscar.cell, species: poscar.atoms.map((atom) => atom.element), labels: numbered(poscar.atoms), title: poscar.title, selectiveDynamics: poscar.selectiveDynamics };
  }
  const crystal = await readCifCrystal(source.text);
  const types = await cifTypeSymbols(source.text, crystal.title);
  return {
    atoms: crystal.atoms, cell: crystal.cell, labels: crystal.atomLabels, title: crystal.title, selectiveDynamics: null,
    species: crystal.atoms.map((atom, index) => speciesKey(types?.[crystal.sourceAtomIndices[index]], atom.element)),
  };
}

/** Above this many atoms the viewer shows atoms where the file puts them. */
export const WHOLE_MOLECULE_ATOM_LIMIT = 20_000;

/**
 * The full cell as the viewer and the workbench show it: atoms wrapped into the cell
 * by a CIF expansion or the file itself are moved by whole lattice vectors so every
 * finite molecule is whole and bonds across cell faces are drawn.
 */
export async function readCrystalView(source: CrystalSource): Promise<CrystalDocument> {
  return crystalView(await readCrystalDocument(source));
}

/** The cell of `readCrystalView` for an already read document. */
export function crystalView(document: CrystalDocument): CrystalDocument {
  return document.atoms.length > WHOLE_MOLECULE_ATOM_LIMIT ? document : { ...document, atoms: wholeMolecules(document.atoms, document.cell).atoms };
}

const number = (value: number) => (Object.is(value, -0) ? "0" : String(value));
const cifLabel = (value: string) => value.replace(/[^A-Za-z0-9_.()+-]/gu, "").slice(0, 28) || "X";
const cifQuoted = (value: string) => `'${value.replace(/'/gu, "")}'`;

/** Source labels, numbered where one source site became several atoms of the cell. */
export function uniqueLabels(labels: readonly string[]) {
  const totals = new Map<string, number>(), seen = new Map<string, number>(), used = new Set<string>();
  const base = labels.map(cifLabel);
  base.forEach((label) => totals.set(label, (totals.get(label) ?? 0) + 1));
  return base.map((label) => {
    if (totals.get(label) === 1 && !used.has(label)) { used.add(label); return label; }
    let next = seen.get(label) ?? 0, candidate: string;
    do candidate = `${label}_${++next}`; while (used.has(candidate) || (totals.get(candidate) ?? 0) > 0);
    seen.set(label, next);
    used.add(candidate);
    return candidate;
  });
}

function cellParameterLines(cell: UnitCell) {
  const length = (v: readonly number[]) => Math.hypot(v[0], v[1], v[2]);
  const angle = (u: readonly number[], v: readonly number[]) => Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (length(u) * length(v))))) * 180 / Math.PI;
  const [a, b, c] = cell;
  return [
    `_cell_length_a ${number(length(a))}`, `_cell_length_b ${number(length(b))}`, `_cell_length_c ${number(length(c))}`,
    `_cell_angle_alpha ${number(angle(b, c))}`, `_cell_angle_beta ${number(angle(a, c))}`, `_cell_angle_gamma ${number(angle(a, b))}`,
  ];
}

/**
 * CIF of explicit atoms. Without `operations` it is P1 and lists every atom; with
 * them it lists only the given atoms, which the operations expand. CIF stores only
 * a, b, c, α, β, γ, so a reader places the cell in the standard orientation (a along
 * x, b in the xy plane); fractional coordinates, not Cartesian ones, are exact.
 */
export function writeCrystalCif(sites: CrystalSites, title: string, operations: readonly SymmetryOperation[] | null = null, spaceGroup: { number: number; symbol: string | null } | null = null) {
  const labels = uniqueLabels(sites.labels);
  const lines = [
    `data_${cifLabel(title.replace(/\s+/gu, "_")) || "crystal"}`,
    `_audit_creation_method ${cifQuoted("Burette")}`,
    ...cellParameterLines(sites.cell),
    ...(spaceGroup ? [`_space_group_IT_number ${spaceGroup.number}`, ...(spaceGroup.symbol ? [`_space_group_name_H-M_alt ${cifQuoted(spaceGroup.symbol)}`] : [])] : operations ? [] : ["_space_group_IT_number 1", "_space_group_name_H-M_alt 'P 1'"]),
    "loop_",
    "_space_group_symop_operation_xyz",
    ...(operations ? operations.map((operation) => cifQuoted(symmetryOperationXyz(operation))) : ["'x,y,z'"]),
    "loop_",
    "_atom_site_label",
    "_atom_site_type_symbol",
    "_atom_site_fract_x",
    "_atom_site_fract_y",
    "_atom_site_fract_z",
    "_atom_site_occupancy",
    ...sites.atoms.map((atom, index) => [labels[index], sites.species[index], ...cartesianToFractional([atom.x, atom.y, atom.z], sites.cell).map(number), "1"].join(" ")),
  ];
  return `${lines.join("\n")}\n`;
}

/** Extended XYZ keeping the source comment and replacing only its Lattice (and pbc). */
export function writeExtendedXyz(atoms: MolecularAtom[], cell: UnitCell, comment: string) {
  const lattice = `Lattice="${cell.flat().map(number).join(" ")}"`;
  let rest = comment.replace(/\bLattice\s*=\s*"[^"]*"/iu, "").replace(/\bpbc\s*=\s*"[^"]*"/iu, "").replace(/\s+/gu, " ").trim();
  if (!/\bProperties\s*=/iu.test(rest)) rest = `Properties=species:S:1:pos:R:3 ${rest}`.trim();
  return serializeXyz(atoms, `${lattice} ${rest} pbc="T T T"`.replace(/\s+/gu, " ").trim());
}

/** The document in its own format, atom order unchanged. */
export function writeCrystalDocument(format: CrystalFormat, document: CrystalDocument) {
  if (format === "xyz") return writeExtendedXyz(document.atoms, document.cell, document.title);
  if (format === "vasp") return writePoscar({ title: document.title, atoms: document.atoms, cell: document.cell, selectiveDynamics: document.selectiveDynamics });
  return writeCrystalCif(document, document.title);
}

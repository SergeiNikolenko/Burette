import { parseCifText } from "molstar/lib/mol-io/reader/cif/text/parser.js";
import { readCifCrystal } from "./cif-crystal";
import { readUnitCell } from "./crystal";
import { analyzeCrystalSymmetry, standardizeCrystal, type CrystalSites, type MoyoAnalyzer, type StandardCellKind, type StandardizedCrystal, type SymmetryAnalysis } from "./crystal-symmetry";
import { parseXyz } from "./xyz";

export type CrystalSourceFormat = "cif" | "xyz";
export type CrystalSource = { format: CrystalSourceFormat; text: string };
export type CrystalRequest =
  | { action: "analyze"; source: CrystalSource; tolerance: number }
  | { action: "standardize"; source: CrystalSource; tolerance: number; cell: StandardCellKind; title: string; expectedNumber?: number };
export type CrystalResults = { analyze: SymmetryAnalysis; standardize: StandardizedCrystal };

/** CIF type symbols per atom-site row of the block readCifCrystal chose. */
async function cifTypeSymbols(text: string, header: string) {
  const parsed = await parseCifText(text).run();
  if (parsed.isError) throw new Error(`Invalid CIF: ${parsed.message}`);
  const block = parsed.result.blocks.find((candidate) => candidate.header === header);
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

/**
 * Atoms of one explicit cell. CIF symmetry is expanded and partial occupancy or disorder
 * refused exactly as when the CIF opens; extended XYZ needs a single frame and a Lattice.
 */
export async function readCrystalSites(source: CrystalSource): Promise<CrystalSites> {
  if (source.format === "xyz") {
    let atoms;
    try {
      ({ atoms } = parseXyz(source.text));
    } catch (error) {
      throw new Error(`Symmetry needs one XYZ frame of element symbols and coordinates. ${error instanceof Error ? error.message : String(error)}`);
    }
    const cell = readUnitCell(source.text);
    if (!cell) throw new Error("This XYZ file has no Lattice in its comment line, so it has no unit cell.");
    return { atoms, cell, species: atoms.map((atom) => atom.element), labels: atoms.map((atom, index) => `${atom.element}${index + 1}`) };
  }
  const crystal = await readCifCrystal(source.text);
  const types = await cifTypeSymbols(source.text, crystal.title);
  return {
    atoms: crystal.atoms, cell: crystal.cell, labels: crystal.atomLabels,
    species: crystal.atoms.map((atom, index) => speciesKey(types?.[crystal.sourceAtomIndices[index]], atom.element)),
  };
}

/** One worker job; `moyo` is the initialized WebAssembly module. */
export async function runCrystalRequest(moyo: MoyoAnalyzer, request: CrystalRequest): Promise<CrystalResults[CrystalRequest["action"]]> {
  const sites = await readCrystalSites(request.source);
  if (request.action === "analyze") return analyzeCrystalSymmetry(moyo, sites, request.tolerance);
  return standardizeCrystal(moyo, sites, request.tolerance, request.cell, { title: request.title, readCif: readCifCrystal, expectedNumber: request.expectedNumber });
}

import { periodicCrystalFormat } from "../molecular-workbench/crystal-io";
import { ELEMENT_SYMBOLS } from "../molecular-workbench/elements";
import { readUnitCell } from "../molecular-workbench/crystal";
import type { MolecularStructure } from "../molecular-workbench/chemistry";
import { runChemistryTask } from "../molecular-workbench/compute-client";
import type { MolecularAtom, UnitCell } from "../molecular-workbench/types";
import { parseXyz, serializeXyz } from "../molecular-workbench/xyz";
import type { ViewerDocument } from "../../types";
import { runReaderTask } from "./reader-task";
import { sourceExtension } from "../science-session/state";

const GRAPH_FORMATS = new Set(["sdf", "sd", "mol"]);
const COORDINATE_FORMATS = new Set(["xyz", "out", "log", "cube", "cub", "molden", "hess", "fchk", "fch"]);
const CRYSTAL_FORMATS = new Set(["cif", "mmcif", "mcif", "vasp"]);

/** Documents whose atoms the workbench can read directly from their source text. */
export function workbenchSupportsDocument(document: ViewerDocument | null): document is ViewerDocument {
  if (!document || document.renderer !== "molstar" || document.mergedCollection || document.dockingRequest) return false;
  const extension = sourceExtension(document);
  return GRAPH_FORMATS.has(extension) || COORDINATE_FORMATS.has(extension) || CRYSTAL_FORMATS.has(extension);
}

export type WorkbenchSource = { atoms: MolecularAtom[]; cell: UnitCell | null; title: string; graphText: string; graphFormat: "xyz" | "sdf" };

function readCell(text: string) {
  try { return readUnitCell(text); } catch { return null; }
}

/** Molecular atoms in source order; fractional CIF and VASP yield the full unit cell. */
export async function readWorkbenchSource(document: ViewerDocument, text: string, signal?: AbortSignal): Promise<WorkbenchSource> {
  const extension = sourceExtension(document);
  if (extension === "molx") throw new Error("This scene has no restored molecular source.");
  const title = document.title.replace(/\.[^.]+$/u, "");
  if (GRAPH_FORMATS.has(extension)) {
    const structure = await runChemistryTask({ action: "parse", source: text, format: "sdf" }, { signal });
    return { atoms: structure.atoms, cell: null, title, graphText: text, graphFormat: "sdf" };
  }
  if (CRYSTAL_FORMATS.has(extension)) {
    if (extension !== "vasp" && !periodicCrystalFormat(extension, text)) {
      const atoms = await runReaderTask({ action: "molecular-cif", text }, { signal });
      return { atoms, cell: null, title, graphText: serializeXyz(atoms, title), graphFormat: "xyz" };
    }
    // The full cell with whole molecules, exactly as the viewer shows it.
    const crystal = await runReaderTask({ action: "crystal", format: extension === "vasp" ? "vasp" : "cif", text }, { signal });
    return { atoms: crystal.atoms, cell: crystal.cell, title, graphText: serializeXyz(crystal.atoms, title), graphFormat: "xyz" };
  }
  if (extension === "xyz") {
    try {
      const { atoms } = parseXyz(text);
      return { atoms, cell: readCell(text), title, graphText: text, graphFormat: "xyz" };
    } catch {
      // A multi-frame XYZ: the workbench uses the first frame, as the viewer opens it.
    }
  }
  const scientific = await runReaderTask({ action: "parse", name: `${title}.${extension}`, text }, { signal });
  const atoms = extension === "xyz" ? scientific.frames[0].atoms : scientific.atoms;
  return { atoms, cell: readCell(text), title, graphText: serializeXyz(atoms, title), graphFormat: "xyz" };
}

const PDB_FORMATS = new Set(["pdb", "ent"]);

/** Documents a quantum input file can be written for: the workbench formats and PDB. */
export function inputExportSupportsDocument(document: ViewerDocument | null): document is ViewerDocument {
  if (!document) return false;
  const workbench: boolean = workbenchSupportsDocument(document);
  return workbench || (document.renderer === "molstar" && !document.mergedCollection && !document.dockingRequest && PDB_FORMATS.has(sourceExtension(document)));
}

export const isPdbDocument = (document: ViewerDocument) => PDB_FORMATS.has(sourceExtension(document));

/** ATOM and HETATM records of the first model, first alternate location only, with
 * the element from columns 77–78 or, without one, from the atom name. */
export function readPdbAtoms(text: string): MolecularAtom[] {
  const atoms: MolecularAtom[] = [];
  let altLoc: string | null = null;
  for (const line of text.split(/\r?\n/u)) {
    if (line.startsWith("ENDMDL")) break;
    if (!line.startsWith("ATOM  ") && !line.startsWith("HETATM")) continue;
    const alt = line[16]?.trim() ?? "";
    if (alt && (altLoc ??= alt) !== alt) continue;
    const name = line.slice(12, 16);
    const raw = line.slice(76, 78).trim() || (name[0] === " " || /\d/u.test(name[0]) ? name.trim().replace(/^\d+/u, "")[0] : name.trim().slice(0, 2)) || "";
    const element = raw.length > 1 ? raw[0].toUpperCase() + raw.slice(1).toLowerCase() : raw.toUpperCase();
    const [x, y, z] = [line.slice(30, 38), line.slice(38, 46), line.slice(46, 54)].map(Number);
    if (!ELEMENT_SYMBOLS.includes(element) || ![x, y, z].every(Number.isFinite)) throw new Error(`PDB atom ${atoms.length + 1} has no element or coordinates.`);
    atoms.push({ element, x, y, z });
  }
  if (!atoms.length) throw new Error("The PDB file has no atoms.");
  return atoms;
}

/** Chemical graph for force-field and property calculations. */
export function readMolecularStructure(source: WorkbenchSource, signal?: AbortSignal): Promise<MolecularStructure> {
  return runChemistryTask({ action: "parse", source: source.graphText, format: source.graphFormat }, { signal });
}

export function chemistryError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

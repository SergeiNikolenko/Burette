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
const CRYSTAL_FORMATS = new Set(["cif", "mmcif", "mcif"]);

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

/** Atoms in source order, plus the cell when the text declares one. A CIF yields its full unit cell. */
export async function readWorkbenchSource(document: ViewerDocument, text: string, signal?: AbortSignal): Promise<WorkbenchSource> {
  const extension = sourceExtension(document);
  if (extension === "molx") throw new Error("This scene has no restored molecular source.");
  const title = document.title.replace(/\.[^.]+$/u, "");
  if (GRAPH_FORMATS.has(extension)) {
    const structure = await runChemistryTask({ action: "parse", source: text, format: "sdf" }, { signal });
    return { atoms: structure.atoms, cell: null, title, graphText: text, graphFormat: "sdf" };
  }
  if (CRYSTAL_FORMATS.has(extension)) {
    const crystal = await runReaderTask({ action: "cif", text }, { signal });
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

/** Chemical graph for force-field and property calculations. */
export function readMolecularStructure(source: WorkbenchSource, signal?: AbortSignal): Promise<MolecularStructure> {
  return runChemistryTask({ action: "parse", source: source.graphText, format: source.graphFormat }, { signal });
}

export function chemistryError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

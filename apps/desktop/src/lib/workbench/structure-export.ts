import type { ViewerDocument } from "../../types";
import { writeCjson } from "../molecular-workbench/cjson-graph";
import { writeExtendedXyz } from "../molecular-workbench/crystal-io";
import { serializeXyz } from "../molecular-workbench/xyz";
import { sourceExtension } from "../science-session/state";
import { readMolecularStructure, readWorkbenchSource, workbenchSupportsDocument } from "./structure";
import type { AgentJobRunner } from "./agent-jobs";

export type StructureExportFormat = "xyz" | "mol" | "cjson";

const GRAPH_FORMATS = new Set(["sdf", "sd", "mol"]);

/**
 * The document's source text as XYZ, MOL or CJSON of the structure the workbench reads
 * from it: the first frame, atoms in source order. A periodic source keeps its cell
 * (extended XYZ, CJSON cell vectors). MOL from an SDF or MOL is its first record as
 * written, without data items, so bond orders and charges are never perceived again.
 */
export async function structureExportText(document: ViewerDocument, text: string, format: StructureExportFormat, signal?: AbortSignal) {
  if (format === "mol" && GRAPH_FORMATS.has(sourceExtension(document))) {
    const end = /^M {2}END[^\S\n]*$/mu.exec(text);
    if (!end) throw new Error("The SDF has no complete record.");
    return `${text.slice(0, end.index).replace(/^﻿/u, "")}M  END\n`;
  }
  const source = await readWorkbenchSource(document, text, signal);
  if (format === "xyz") return source.cell ? writeExtendedXyz(source.atoms, source.cell, source.title) : serializeXyz(source.atoms, source.title);
  const structure = await readMolecularStructure(source, signal);
  if (format === "mol") return structure.molfile;
  return `${JSON.stringify(writeCjson({ title: source.title, atoms: structure.atoms, bonds: structure.bonds, cell: source.cell }), null, 2)}\n`;
}

const MIME_TYPES: Record<StructureExportFormat, string> = { xyz: "chemical/x-xyz", mol: "chemical/x-mdl-molfile", cjson: "application/json" };

/** Export → Structure for agents: the source revision as one coordinate file; the document is never changed. */
export const structureExportJob: AgentJobRunner<"structure_export"> = {
  unavailable: snapshot => workbenchSupportsDocument(snapshot.document) ? null : "Export structures from a MOL, SDF, XYZ, CIF, POSCAR or quantum output source.",
  async run(input, { format }, { signal, stem, artifact }) {
    const text = await structureExportText(input.document, input.text, format, signal);
    return { summary: { format }, artifacts: [await artifact("structure", `${stem}.${format}`, MIME_TYPES[format], text)] };
  },
};

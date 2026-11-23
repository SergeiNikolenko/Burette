import { isBrowserDraftSource, readBrowserDevVirtualTextDocument } from "../browser-dev-documents";
import { classifySourceShape } from "../source-editing/policy";
import type { ViewerDocument } from "../../types";
import { sourceExtension } from "../science-session/state";
import { graphMetadataData, hasGraphMetadata, readGraphMetadata, type GraphMetadata } from "./graph-metadata";

const GRAPH_EXTENSIONS = new Set(["sdf", "sd", "mol"]);
const MAX_EDITABLE_VIRTUAL_GRAPHS = 256;
const editableVirtualGraphs = new Set<string>();

/** Marks a single-record generated SDF/MOL document as editable in Tauri and browser runtimes. */
export function markEditableVirtualGraph(documentId: string) {
  if (!documentId) return;
  if (editableVirtualGraphs.size >= MAX_EDITABLE_VIRTUAL_GRAPHS) {
    const oldest = editableVirtualGraphs.values().next().value;
    if (oldest !== undefined) editableVirtualGraphs.delete(oldest);
  }
  editableVirtualGraphs.add(documentId);
}

export function isEditableVirtualGraph(documentId: string) {
  return editableVirtualGraphs.has(documentId);
}

/** Atom and bond editing needs an explicit graph: one SDF/MOL record in a single-structure scene. */
export function structureEditAvailable(document: ViewerDocument | null): document is ViewerDocument {
  if (!document || document.renderer !== "molstar" || !GRAPH_EXTENSIONS.has(sourceExtension(document))
    || document.dockingRequest || document.mergedCollection) return false;
  if (!document.virtual) return true;
  if (editableVirtualGraphs.has(document.id)) return true;
  const text = isBrowserDraftSource(document) ? readBrowserDevVirtualTextDocument(document.path) : null;
  return text !== null && classifySourceShape(sourceExtension(document), text) === "single";
}

export { atomAnnotations, type AtomAnnotation } from "./graph-annotations";

/** First record of an SDF/MOL text: its title line and the data items after `M  END`. */
function recordParts(source: string) {
  const record = source.replace(/\r\n?/gu, "\n").split(/^\$\$\$\$[^\n]*$/mu)[0] ?? "";
  const lines = record.split("\n");
  const end = lines.findIndex((line) => line.startsWith("M  END"));
  const data = end < 0 ? "" : lines.slice(end + 1).join("\n").replace(/^\n+|\n+$/gu, "");
  return { title: lines[0] ?? "", data };
}

/**
 * Draft text for an edited graph: the edited V3000 connection table under the
 * source record's own title, followed by its SDF data items. MOL files stay bare.
 */
export function graphDraftText(source: string, extension: string, molfile: string, metadata?: GraphMetadata | null) {
  const { title, data } = recordParts(source);
  const table = molfile.replace(/\r\n?/gu, "\n").replace(/\s+$/u, "").split("\n");
  table[0] = title;
  const body = table.join("\n");
  if (extension === "mol") {
    if (metadata || hasGraphMetadata(data)) throw new Error("MOL files cannot carry SDF metadata. Save as SDF first.");
    return `${body}\n`;
  }
  const nextData = metadata ? graphMetadataData(data, metadata) : data;
  return `${body}\n${nextData ? `${nextData}\n\n` : ""}$$$$\n`;
}

/** Metadata is read before editing; malformed reserved data never reaches a draft. */
export function graphSourceMetadata(source: string, extension: string, atomCount: number, { initialize = true } = {}) {
  const { data } = recordParts(source);
  if (extension === "mol") {
    if (hasGraphMetadata(data)) throw new Error("MOL files cannot carry SDF metadata. Save as SDF first.");
    return null;
  }
  return initialize || hasGraphMetadata(data) ? readGraphMetadata(data, atomCount) : null;
}

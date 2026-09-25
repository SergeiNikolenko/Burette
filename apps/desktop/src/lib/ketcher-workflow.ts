import type { KetcherImportRequest, KetcherSource3D } from "../components/types";

type KetcherMolSerializer = typeof import("ketcher-core")["MolSerializer"];

export function queueKetcherImportRequest(request: KetcherImportRequest) {
  const targetWindow = window as Window & { __buretteKetcherImportRequest?: KetcherImportRequest | null };
  targetWindow.__buretteKetcherImportRequest = request;
  window.dispatchEvent(new CustomEvent("burette:ketcher-import", { detail: request }));
}

export function ketcherSource3DFromText(title: string, text: string, extension: string): KetcherSource3D | undefined {
  const cleanText = text.trim();
  if (!cleanText) return undefined;
  const cleanExtension = extension.trim().replace(/^\./u, "").toLowerCase();
  if (!["sdf", "sd", "mol"].includes(cleanExtension)) return undefined;
  return {
    title: title.trim() || "structure",
    extension: cleanExtension,
    text: cleanText,
  };
}

export function ketcherDraftMolfileFromImportText(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!normalized.trim()) return null;
  const records = normalized.split(/\n\$\$\$\$\s*(?:\n|$)/u).map((record) => record.trimEnd()).filter(Boolean);
  if (records.length === 1 && normalized !== records[0]) {
    const [record] = records;
    return record && looksLikeMolfile(record) ? record + "\n" : null;
  }
  return looksLikeMolfile(normalized) ? normalized + "\n" : null;
}

function looksLikeMolfile(text: string) {
  const lines = text.split("\n");
  return lines.length >= 4 && /^\s*\d+\s+\d+\b/u.test(lines[3] ?? "");
}

// ketcher-core writes `'' + struct.name`, so structures built from SMILES get a
// literal "null" name line. Blank that header line in MOL, SDF, and RXN exports.
const KETCHER_NULL_NAME_LINE = /(^|\$\$\$\$\r?\n|\$RXN[^\r\n]*\r?\n|\$MOL\r?\n)(?:null|undefined)(?=\r?\n)/gu;

export function normalizeKetcherMolfileNames(text: string) {
  return text.replace(KETCHER_NULL_NAME_LINE, "$1");
}

/**
 * Parses a molfile for direct `editor.struct()` loading. Mirrors ketcher-core's
 * prepareStructToRender (the setMolecule path): without implicit hydrogens,
 * terminal heteroatoms render as O/N instead of OH/NH2.
 */
export function deserializeKetcherMolfile(MolSerializer: KetcherMolSerializer, molfile: string) {
  const struct = new MolSerializer().deserialize(molfile);
  struct.rescale();
  struct.initHalfBonds();
  struct.initNeighbors();
  struct.setImplicitHydrogen();
  struct.setStereoLabelsToAtoms();
  struct.markFragments();
  return struct;
}

import previewFormatRegistry from "../../../../../config/preview-formats.json";
import type { SourceNotEditableReason, SourcePreviewMode } from "./types";

export const SOURCE_LIVE_PREVIEW_MAX_BYTES = 1_000_000;
export const SOURCE_EDIT_MAX_BYTES = 3_000_000;

const EDITABLE_FORMAT_IDS = new Set(["pdb", "cif", "mmcif", "sdf", "mol", "mol2", "xyz", "gro"]);

export const sourceEditableExtensions = new Set(
  previewFormatRegistry.formats
    .filter((format) => EDITABLE_FORMAT_IDS.has(format.id))
    .flatMap((format) => format.extensions)
    .map((extension) => extension.toLowerCase()),
);

export type SourceShape = "single" | "collection" | "multi-frame" | "multi-source";
export type SourceKind = "local" | "virtual" | "generated" | "combined" | "docking";

export type SourceEditEligibilityInput = {
  extension: string;
  byteCount: number;
  truncated?: boolean;
  decodeLossy?: boolean;
  sourceKind?: SourceKind;
  shape?: SourceShape;
  compressed?: boolean;
  binary?: boolean;
};

export type SourceEditEligibility =
  | { editable: true; previewMode: SourcePreviewMode }
  | { editable: false; reason: SourceNotEditableReason };

export function utf8ByteCount(content: string) {
  return new TextEncoder().encode(content).byteLength;
}

export function classifyPreviewMode(byteCount: number): SourcePreviewMode | "read-only" {
  if (byteCount > SOURCE_EDIT_MAX_BYTES) return "read-only";
  if (byteCount > SOURCE_LIVE_PREVIEW_MAX_BYTES) return "manual";
  return "live";
}

export function classifySourceEditEligibility(input: SourceEditEligibilityInput): SourceEditEligibility {
  const extension = input.extension.replace(/^\./u, "").toLowerCase();
  if (input.truncated) return { editable: false, reason: "truncated" };
  if (input.decodeLossy) return { editable: false, reason: "lossy_encoding" };
  if (input.binary) return { editable: false, reason: "binary_source" };
  if (input.compressed) return { editable: false, reason: "compressed_source" };
  if (input.sourceKind === "virtual") return { editable: false, reason: "virtual_source" };
  if (input.sourceKind === "generated") return { editable: false, reason: "generated_source" };
  if (input.sourceKind === "combined") return { editable: false, reason: "combined_source" };
  if (input.sourceKind === "docking") return { editable: false, reason: "docking_source" };
  if (input.shape === "multi-source") return { editable: false, reason: "multi_source" };
  if (input.shape === "collection" || input.shape === "multi-frame") {
    return { editable: false, reason: "unsupported_shape" };
  }
  if (!sourceEditableExtensions.has(extension)) return { editable: false, reason: "unsupported_format" };
  const previewMode = classifyPreviewMode(input.byteCount);
  if (previewMode === "read-only") return { editable: false, reason: "too_large" };
  return { editable: true, previewMode };
}

function hasMultipleSdfRecords(content: string) {
  return content.split(/^\$\$\$\$\s*$/gmu).filter((record) => record.trim().length > 0).length > 1;
}

function hasMultipleXyzFrames(content: string) {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  let cursor = 0;
  let frames = 0;
  while (cursor < lines.length) {
    while (cursor < lines.length && lines[cursor]?.trim() === "") cursor += 1;
    if (cursor >= lines.length) break;
    const atomCount = Number.parseInt(lines[cursor]?.trim() ?? "", 10);
    if (!Number.isInteger(atomCount) || atomCount < 0) return false;
    cursor += atomCount + 2;
    frames += 1;
    if (frames > 1) return true;
  }
  return false;
}

export function classifySourceShape(extension: string, content: string): SourceShape {
  const normalized = extension.replace(/^\./u, "").toLowerCase();
  if ((normalized === "sdf" || normalized === "sd") && hasMultipleSdfRecords(content)) return "collection";
  if (normalized === "xyz" && hasMultipleXyzFrames(content)) return "multi-frame";
  if (["pdb", "ent", "pdbqt", "pqr", "xpdb"].includes(normalized)) {
    const modelCount = content.match(/^MODEL(?:\s|$)/gmu)?.length ?? 0;
    if (modelCount > 1) return "multi-frame";
  }
  if (["cif", "mmcif", "mcif"].includes(normalized)) {
    const dataBlockCount = content.match(/^data_\S+/gmu)?.length ?? 0;
    if (dataBlockCount > 1) return "collection";
  }
  return "single";
}

export function sourceDraftValidationError(extension: string, content: string): string | null {
  const normalized = extension.replace(/^\./u, "").toLowerCase();
  const text = content.replace(/\r\n?/gu, "\n");
  if (!text.trim()) return "The draft is empty.";
  if (["pdb", "ent", "pdbqt", "pqr", "xpdb"].includes(normalized)) {
    return /^(?:ATOM  |HETATM)/mu.test(text) ? null : "The PDB draft contains no ATOM or HETATM records.";
  }
  if (["cif", "mmcif", "mcif"].includes(normalized)) {
    return /^data_\S+/mu.test(text) && /_atom_site[._]/u.test(text)
      ? null
      : "The CIF draft contains no atom_site structure block.";
  }
  if (["mol", "sdf", "sd"].includes(normalized)) {
    return /\bV(?:2000|3000)\b/u.test(text) ? null : "The Molfile draft has no V2000 or V3000 counts line.";
  }
  if (normalized === "mol2") {
    return /@<TRIPOS>MOLECULE/u.test(text) && /@<TRIPOS>ATOM/u.test(text)
      ? null
      : "The MOL2 draft has no MOLECULE or ATOM section.";
  }
  if (normalized === "xyz") {
    const lines = text.split("\n");
    const atomCount = Number.parseInt(lines[0]?.trim() ?? "", 10);
    const atomLines = lines.slice(2).filter((line) => line.trim().length > 0);
    return Number.isInteger(atomCount) && atomCount > 0 && atomLines.length >= atomCount
      ? null
      : "The XYZ draft has an invalid atom count or incomplete atom block.";
  }
  if (normalized === "gro") {
    const lines = text.split("\n");
    const atomCount = Number.parseInt(lines[1]?.trim() ?? "", 10);
    const bodyLines = lines.slice(2).filter((line) => line.trim().length > 0);
    return Number.isInteger(atomCount) && atomCount > 0 && bodyLines.length >= atomCount + 1
      ? null
      : "The GRO draft has an invalid atom count or incomplete atom block.";
  }
  return null;
}

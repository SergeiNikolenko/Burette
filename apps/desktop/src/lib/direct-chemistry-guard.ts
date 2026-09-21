import { parseStructureComposition, type StructureCompositionSummary } from "./structure-composition";
import { readStructureText } from "./structure-text";

export const DIRECT_CHEMISTRY_JOB_ATOM_LIMIT = 300;
const DIRECT_CHEMISTRY_JOB_READ_LIMIT = 4 * 1024 * 1024;

export async function directChemistryJobGuardMessage(
  engine: "xTB" | "CREST" | "PRISM",
  inlineText: string | null | undefined,
  extension: string | null | undefined,
  path: string | null | undefined,
) {
  const atomCount = await directChemistryJobAtomCount(inlineText, extension, path);
  if (atomCount === null || atomCount <= DIRECT_CHEMISTRY_JOB_ATOM_LIMIT) return null;
  return `${engine} is disabled for full structures above ${DIRECT_CHEMISTRY_JOB_ATOM_LIMIT} atoms (${atomCount} atoms detected). Select an object or open a small-molecule file first.`;
}

async function directChemistryJobAtomCount(
  inlineText: string | null | undefined,
  extension: string | null | undefined,
  path: string | null | undefined,
) {
  const text = typeof inlineText === "string" && inlineText.trim()
    ? inlineText
    : path ? await readStructureText(path, { maxBytes: DIRECT_CHEMISTRY_JOB_READ_LIMIT }).catch(() => "") : "";
  if (!text.trim()) return null;
  return estimateStructureAtomCount(text, extension);
}

function estimateStructureAtomCount(text: string, extension: string | null | undefined) {
  const normalizedExtension = String(extension || "").replace(/^\./u, "").toLowerCase();
  const summary = parseStructureComposition(text, normalizedExtension);
  const summaryMax = summary ? structureAtomCountFromSummary(summary) : null;
  return summaryMax ?? fallbackStructureAtomCount(text, normalizedExtension);
}

// The inspector has the same parsed summary in hand, so it can warn about an
// oversized job before the click rather than letting the run fail into a toast.
export function structureAtomCountFromSummary(summary: StructureCompositionSummary) {
  const counts = [
    ...summary.rows,
    ...summary.componentRows,
    ...summary.polymerRows,
    ...summary.ligandRows,
    ...summary.solventRows,
  ].flatMap((row) => atomCountsFromLabelValue(row.label, row.value));
  const max = Math.max(0, ...counts);
  return max > 0 ? max : null;
}

function atomCountsFromLabelValue(label: string, value: string) {
  const counts: number[] = [];
  const labelValue = `${label} ${value}`;
  for (const match of labelValue.matchAll(/([\d,]+)\s+atoms?\b/giu)) {
    const count = Number.parseInt(match[1].replaceAll(",", ""), 10);
    if (Number.isFinite(count) && count > 0) counts.push(count);
  }
  if (/^atoms$/iu.test(label.trim())) {
    const count = Number.parseInt(value.replaceAll(",", "").trim(), 10);
    if (Number.isFinite(count) && count > 0) counts.push(count);
  }
  return counts;
}

function fallbackStructureAtomCount(text: string, extension: string) {
  if (["pdb", "pdbqt", "ent"].includes(extension)) {
    const count = text.split(/\r?\n/u).filter((line) => line.startsWith("ATOM") || line.startsWith("HETATM")).length;
    return count > 0 ? count : null;
  }
  if (["xyz", "trj", "log"].includes(extension)) {
    const count = Number.parseInt(text.trimStart().split(/\s+/u)[0] ?? "", 10);
    return Number.isFinite(count) && count > 0 ? count : null;
  }
  return null;
}

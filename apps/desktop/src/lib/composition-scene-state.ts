import type { StructureSummaryRow } from "./structure-composition";

export type CompositionSceneState = {
  present?: boolean;
  counts?: { atoms: number; residues: number; chains: number; types: number };
};

// The file summary identifies rows; the live scene decides whether they still
// exist and how much remains after a subset is removed. Hidden cells still count.
export function compositionRowFromScene(row: StructureSummaryRow, scene?: CompositionSceneState): StructureSummaryRow | null {
  if (scene?.present === false) return null;
  const counts = scene?.counts;
  if (!counts || ![counts.atoms, counts.residues, counts.chains, counts.types]
    .every(value => Number.isSafeInteger(value) && value >= 0)) return row;
  const amount: Record<string, number> = {
    atom: counts.atoms, residue: counts.residues, chain: counts.chains,
    type: counts.types, instance: counts.residues, molecule: counts.residues, ion: counts.residues,
  };
  // Ion group summaries include species names and counts, which cannot be kept
  // after deleting a species. Its children still identify the remaining species.
  const value = row.label === "Ions"
    ? `${counts.residues} ${counts.residues === 1 ? "ion" : "ions"} / ${counts.atoms} atoms`
    : row.value.replace(/\b[\d,]+ (atom|residue|chain|type|instance|molecule|ion)s?\b/g,
      (_, noun: string) => `${amount[noun]} ${noun}${amount[noun] === 1 ? "" : "s"}`);
  return value === row.value ? row : { ...row, value };
}

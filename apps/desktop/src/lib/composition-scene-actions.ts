import type { StructureSummaryRow, StructureViewerAction } from "./structure-composition";
import { pymolQueryForSelector } from "./molstar-selection-query";

// Group controls address a whole component kind. Child controls must carry an
// exact query: falling back to the kind would hide every chain for a Chain A click.
export function compositionSceneAction(
  row: StructureSummaryRow,
  operation: "hide" | "show" | "remove",
): StructureViewerAction | null {
  const selector = row.action && "selector" in row.action ? row.action.selector : null;
  const kind = selector?.kind;
  if (kind !== "polymer" && kind !== "ligand" && kind !== "ion" && kind !== "water") return null;
  const query = pymolQueryForSelector(selector);
  if (!query) return null;
  const verb = operation === "hide" ? "Hide" : operation === "show" ? "Show" : "Remove";
  const label = `${verb} ${row.label.toLowerCase()}`;
  return {
    type: operation === "hide" ? "hide_components" : operation === "show" ? "show_components" : "remove_components",
    label,
    kind,
    query, componentLabel: row.label,
  };
}

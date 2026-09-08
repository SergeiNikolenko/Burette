import type { MenuItemSpec } from "./menu-types";
import type { CompositionSceneEdit, StructureSummaryRow, StructureViewerAction } from "../lib/structure-composition";
import { pymolQueryForSelector } from "../lib/molstar-selection-query";

// Commands deliberately don't pretend to show a single current style: a row
// can span multiple scene components with different representations.
export function compositionStyleMenu(
  row: StructureSummaryRow,
  run: (action: StructureViewerAction) => void,
  color?: string,
): MenuItemSpec[] {
  const selector = row.action && "selector" in row.action ? row.action.selector : undefined;
  const query = pymolQueryForSelector(selector);
  const kind = selector?.kind;
  if (!query || (kind !== "polymer" && kind !== "ligand" && kind !== "ion" && kind !== "water")) return [];
  const edit = (change: CompositionSceneEdit) => run({
    type: "edit_components", label: `Update ${row.label}`, query,
    componentLabel: row.label, kind, edit: change,
  });
  const types = [
    ...(kind === "polymer" ? [["cartoon", "Cartoon"], ["backbone", "Backbone"]] : []),
    ["ball-and-stick", "Ball & Stick"], ["spacefill", "Spacefill"],
    ["line", "Line"], ["molecular-surface", "Molecular Surface"],
  ];
  return [
    ...(row.action?.type === "focus_ligand" ? [] : [{ kind: "item" as const, id: "focus-component", text: "Focus", action: () => run({ type: "focus_selection", label: `Focus ${row.label}`, selector: selector! }) }]),
    { kind: "separator" },
    { kind: "submenu", id: "component-representation", text: "Representation", items: types.map(([value, text]) => ({
      kind: "item", id: `representation-${value}`, text, action: () => edit({ operation: "representation", value }),
    })) },
    { kind: "submenu", id: "component-opacity", text: "Opacity", items: [100, 75, 50, 25].map(value => ({
      kind: "item", id: `opacity-${value}`, text: `${value}%`, action: () => edit({ operation: "opacity", value: value / 100 }),
    })) },
    { kind: "label", id: "component-colour", text: "Colour" },
    { kind: "swatches", id: "component-tint", label: "Colour", activeColor: color, colors: ["#af52de", "#0a84ff", "#40c8e0", "#32d74b", "#ffd60a", "#ff9f0a", "#ff453a", "#ff6482", "#98989d", "#f2f2f7"], action: value => edit({ operation: "color", value }) },
  ];
}

import { ELEMENT_SYMBOLS } from "../../../lib/molecular-workbench/elements";
import type { GraphEditResult } from "../../../lib/molecular-workbench/graph-edit";

export const BOND_ORDERS = [["0", "None"], ["1", "Single"], ["2", "Double"], ["3", "Triple"]] as const;

export function label(structure: GraphEditResult, atom: number) {
  return `${structure.atoms[atom]?.element ?? "?"}${atom + 1}`;
}

export function bondName(order: number) {
  return order === 1.5 ? "Aromatic" : BOND_ORDERS.find(([value]) => Number(value) === order)?.[1] ?? String(order);
}

export function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function normalizeElement(text: string) {
  const trimmed = text.trim();
  const symbol = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  return ELEMENT_SYMBOLS.includes(symbol) ? symbol : null;
}

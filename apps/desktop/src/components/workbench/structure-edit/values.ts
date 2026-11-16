import { ELEMENT_SYMBOLS } from "../../../lib/molecular-workbench/elements";
import type { GraphEditResult } from "../../../lib/molecular-workbench/graph-edit";

export const BOND_ORDERS = [["0", "None"], ["1", "Single"], ["2", "Double"], ["3", "Triple"]] as const;
const DATIVE = ["9", "Dative"] as const;
const NONMETALS = new Set("H He B C N O F Ne Si P S Cl Ar Ge As Se Br Kr Sb Te I Xe At Rn".split(" "));

/** Dative is offered for a bond to a metal, or one that already is dative. */
export function bondOrderChoices(elements: string[], order: number | undefined) {
  return order === 9 || elements.some(element => !NONMETALS.has(element)) ? [...BOND_ORDERS, DATIVE] : BOND_ORDERS;
}

export function label(structure: GraphEditResult, atom: number) {
  return `${structure.atoms[atom]?.element ?? "?"}${atom + 1}`;
}

export function bondName(order: number) {
  return order === 1.5 ? "Aromatic" : order === 9 ? DATIVE[1] : BOND_ORDERS.find(([value]) => Number(value) === order)?.[1] ?? String(order);
}

export function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function normalizeElement(text: string) {
  const trimmed = text.trim();
  const symbol = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  return ELEMENT_SYMBOLS.includes(symbol) ? symbol : null;
}

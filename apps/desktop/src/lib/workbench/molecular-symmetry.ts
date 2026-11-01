import { ELEMENT_SYMBOLS } from "../molecular-workbench/elements";
import type { EquivalenceSet, PointGroupAtom, SymmetryOperation } from "../molecular-workbench/symmetry/point-group";
import type { MolecularAtom, Vec3 } from "../molecular-workbench/types";

/** Displacements below this are numerical noise: symmetrizing leaves the structure as it is. */
export const SYMMETRIZE_NO_OP_DISPLACEMENT = 1e-6;

const HYDROGEN_ISOTOPES: Record<string, number> = { D: 2, T: 3 };

function canonicalElement(element: string) {
  const trimmed = element.trim();
  if (trimmed in HYDROGEN_ISOTOPES) return "H";
  const symbol = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  if (!ELEMENT_SYMBOLS.includes(symbol)) throw new Error(`Unknown element: ${element}`);
  return symbol;
}

/**
 * Point-group atoms in source order. `isotopes` holds mass numbers (0 = natural);
 * D and T symbols stay hydrogen isotopes, so D2O and H2O keep their own groups.
 */
export function pointGroupAtoms(atoms: readonly MolecularAtom[], isotopes: readonly number[] | null = null): PointGroupAtom[] {
  if (isotopes && isotopes.length !== atoms.length) throw new Error("The isotope labels do not match the atoms.");
  return atoms.map((atom, index) => {
    const isotope = isotopes?.[index] || HYDROGEN_ISOTOPES[atom.element.trim()] || 0;
    return { element: canonicalElement(atom.element), x: atom.x, y: atom.y, z: atom.z, ...(isotope ? { isotope } : {}) };
  });
}

/**
 * The XYZ text with new coordinates for its atoms, in order. Element tokens, the
 * comment line and any extra columns stay exactly as they were.
 */
export function xyzWithPositions(text: string, coordinates: readonly Vec3[]) {
  const lines = text.split("\n");
  if (Number(lines[0]?.trim()) !== coordinates.length) throw new Error("The structure changed while it was symmetrized. Try again.");
  coordinates.forEach((position, index) => {
    const line = lines[index + 2];
    const fields = line?.trim().split(/\s+/u) ?? [];
    if (fields.length < 4) throw new Error("The structure changed while it was symmetrized. Try again.");
    lines[index + 2] = [fields[0], ...position.map(String), ...fields.slice(4)].join(" ") + (line.endsWith("\r") ? "\r" : "");
  });
  return lines.join("\n");
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const superscript = (value: number) => String(value).replace(/\d/gu, (digit) => SUPERSCRIPT[Number(digit)]);

/** Schoenflies symbol split for display: the letter and its subscript, as in C₂ᵥ or D∞h. */
export function schoenfliesParts(symbol: string) {
  return { base: symbol.charAt(0), sub: symbol.slice(1) };
}

/** Display parts of an operation: E, i, σᵥ, C₃², S₄³; in D groups primes mark the C₂′ and C₂″ axes. */
export type OperationSymbol = { base: string; sub: string; sup: string; prime: string };
const REFLECTION_SUB: Record<SymmetryOperation["orientation"], string> = { none: "", horizontal: "h", vertical: "v", dihedral: "d" };
const ROTATION_PRIME: Record<SymmetryOperation["orientation"], string> = { none: "", horizontal: "′", vertical: "", dihedral: "″" };

export function operationSymbol(operation: SymmetryOperation, pointGroup = ""): OperationSymbol {
  const order = operation.order === null ? "∞" : String(operation.order);
  const power = operation.power > 1 ? String(operation.power) : "";
  switch (operation.kind) {
    case "identity": return { base: "E", sub: "", sup: "", prime: "" };
    case "inversion": return { base: "i", sub: "", sup: "", prime: "" };
    // C2v tables name the second vertical plane σv′; libmsym reports it as dihedral.
    case "reflection": return pointGroup === "C2v" && operation.orientation === "dihedral"
      ? { base: "σ", sub: "v", sup: "", prime: "′" }
      : { base: "σ", sub: REFLECTION_SUB[operation.orientation], sup: "", prime: "" };
    case "rotation": return { base: "C", sub: order, sup: power, prime: pointGroup.startsWith("D") ? ROTATION_PRIME[operation.orientation] : "" };
    case "improper-rotation": return { base: "S", sub: order, sup: power, prime: "" };
  }
}

/** Classes of the group as in a character-table header: count and representative operation. */
export function operationClasses(operations: readonly SymmetryOperation[], pointGroup = "") {
  const classes = new Map<number, { count: number; representative: SymmetryOperation }>();
  for (const operation of operations) {
    const entry = classes.get(operation.classIndex);
    if (!entry) classes.set(operation.classIndex, { count: 1, representative: operation });
    else {
      entry.count++;
      if (operation.power < entry.representative.power) entry.representative = operation;
    }
  }
  return [...classes.values()].map(({ count, representative }) => ({ count, symbol: operationSymbol(representative, pointGroup) }));
}

/** Equivalence sets with their element, largest first; single atoms on symmetry elements last. */
export function equivalenceRows(sets: readonly EquivalenceSet[], atoms: readonly PointGroupAtom[]) {
  return sets.map((set, index) => {
    const atom = atoms[set.atoms[0]];
    const element = atom ? `${atom.isotope ? superscript(atom.isotope) : ""}${atom.element}` : "?";
    return { index, element, atoms: [...set.atoms].sort((a, b) => a - b) };
  }).sort((a, b) => b.atoms.length - a.atoms.length || a.atoms[0] - b.atoms[0]);
}

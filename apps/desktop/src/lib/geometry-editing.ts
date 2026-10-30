import {
  atomsFromZmatrixRows,
  formatZmatrix as zmatrixText,
  parseXyzAtoms,
  placeInReferenceFrame,
  zmatrixRowsFromAtoms,
  type CoordinateAtom,
  type ZmatrixRow,
} from "../../../../scripts/internal-coordinates.mjs";

export type { ZmatrixRow };
export { zmatrixText };
export type InternalCoordinateKind = "bond" | "angle" | "dihedral";

export const INTERNAL_COORDINATE_KINDS: InternalCoordinateKind[] = ["bond", "angle", "dihedral"];

export type GeometryBase = {
  text: string;
  lines: string[];
  atoms: CoordinateAtom[];
  rows: ZmatrixRow[];
};

// Below this displacement an atom keeps its original source line verbatim, so a
// saved edit only rewrites the atoms that actually moved.
const UNCHANGED_POSITION_A = 1e-12;

export function geometryEditableExtension(extension: string) {
  return extension.replace(/^\./u, "").toLowerCase() === "xyz";
}

export function geometryBase(text: string): GeometryBase {
  const normalized = text.replace(/\r\n?/gu, "\n");
  const atoms = parseXyzAtoms(normalized);
  return { text, lines: normalized.split("\n"), atoms, rows: zmatrixRowsFromAtoms(atoms) };
}

export function clampInternalCoordinate(kind: InternalCoordinateKind, value: number) {
  if (kind === "bond") return value;
  if (kind === "angle") return Math.min(180, Math.max(0, value));
  const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && value > 0 ? 180 : wrapped;
}

export function withInternalCoordinate(rows: ZmatrixRow[], atom: number, slot: number, value: number) {
  return rows.map((row, index) => index === atom
    ? { ...row, values: row.values.map((current, j) => j === slot ? clampInternalCoordinate(INTERNAL_COORDINATE_KINDS[slot], value) : current) }
    : row);
}

/** Rebuilds XYZ text for edited rows in the base orientation. Throws on impossible geometry. */
export function geometryText(base: GeometryBase, rows: ZmatrixRow[]) {
  const atoms = placeInReferenceFrame(atomsFromZmatrixRows(rows), base.atoms);
  const lines = [...base.lines];
  atoms.forEach((atom, index) => {
    const original = base.atoms[index].position;
    if (atom.position.every((value, axis) => Math.abs(value - original[axis]) < UNCHANGED_POSITION_A)) return;
    // Preserve small transverse components: rounding to six decimals can turn
    // a valid near-linear angle into a singular 180-degree exported geometry.
    lines[index + 2] = [atom.element, ...atom.position].join(" ");
  });
  return lines.join("\n");
}

export function internalCoordinateUnit(kind: InternalCoordinateKind) {
  return kind === "bond" ? "Å" : "°";
}

export function formatInternalCoordinate(kind: InternalCoordinateKind, value: number) {
  return value.toFixed(kind === "bond" ? 4 : 2);
}

import { runGraphTask } from "../molecular-workbench/graph-compute-client";
import type { MolecularStructure } from "../molecular-workbench/molecular-graph";
import type { GraphEditResult } from "../molecular-workbench/graph-edit";
import type { Vec3 } from "../molecular-workbench/types";
import { atomAnnotations } from "./graph-annotations";

/**
 * The V3000 molfile with new atom coordinates (in its atom-block order) and nothing else
 * changed: elements, charges, isotopes, stereo flags and bonds keep their text.
 */
export function molfileWithPositions(molfile: string, coordinates: readonly Vec3[]) {
  const rows = molfile.split("\n");
  const begin = rows.indexOf("M  V30 BEGIN ATOM"), end = rows.indexOf("M  V30 END ATOM");
  if (begin < 0 || end - begin - 1 !== coordinates.length) throw new Error("The new coordinates do not match the atoms.");
  for (let row = begin + 1; row < end; row++) {
    const position = coordinates[row - begin - 1];
    if (position.length !== 3 || position.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e6)) throw new Error("Coordinates must be finite and within 1000000 Å.");
    const match = /^(M {2}V30 \d+ \S+ )\S+ \S+ \S+((?: .*)?)$/u.exec(rows[row]);
    if (!match || rows[row].endsWith("-")) throw new Error("This atom record cannot be rewritten safely.");
    rows[row] = `${match[1]}${position.map((value) => Number(value.toFixed(10))).join(" ")}${match[2]}`;
  }
  return rows.join("\n");
}

/**
 * Accepts a position-only change: the same atoms (elements, charges, isotopes) in the
 * same order with the same bonds, at the requested coordinates.
 */
export function checkPositionsOnlyEdit(before: GraphEditResult, after: GraphEditResult, coordinates: readonly Vec3[]) {
  const same = after.atoms.length === before.atoms.length
    && after.atoms.every((atom, index) => atom.element === before.atoms[index].element)
    && JSON.stringify(atomAnnotations(after.molfile)) === JSON.stringify(atomAnnotations(before.molfile))
    && JSON.stringify(bondKeys(after)) === JSON.stringify(bondKeys(before));
  if (!same) throw new Error("The structure would change chemically, so it was left as it was.");
  const off = after.atoms.some((atom, index) => [atom.x, atom.y, atom.z].some((value, axis) => Math.abs(value - coordinates[index][axis]) > 1e-8));
  if (off) throw new Error("The new coordinates could not be written exactly.");
}

/** Rewrite the connection table in source atom order. */
export function normalizeGraphOrder(structure: MolecularStructure, signal: AbortSignal) {
  return runGraphTask({
    action: "edit-graph",
    molecule: structure,
    edits: [{ kind: "reorder-atoms", order: structure.atoms.map((_, index) => index) }],
  }, { signal });
}

export async function replaceGraphPositions(structure: GraphEditResult, coordinates: Vec3[], signal: AbortSignal) {
  const source = molfileWithPositions(structure.molfile, coordinates);
  const parsed = await runGraphTask({ action: "parse", source, format: "mol" }, { signal });
  const next = await normalizeGraphOrder(parsed, signal);
  checkPositionsOnlyEdit(structure, next, coordinates);
  return next;
}

function bondKeys(structure: GraphEditResult) {
  return structure.bonds.map((bond) => `${Math.min(bond.a, bond.b)}-${Math.max(bond.a, bond.b)}:${bond.order}`).sort();
}

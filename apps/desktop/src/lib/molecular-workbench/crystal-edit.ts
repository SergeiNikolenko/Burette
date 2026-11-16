import { crystalView, readCrystalDocument, writeCrystalCif, writeCrystalDocument, type CrystalDocument, type CrystalFormat, type CrystalSource } from "./crystal-io";
import { buildSupercell, cellParametersOf, replaceCell, scaleVolume, signedVolume, standardOrientation, wrapAtoms, type CoordinatePolicy } from "./crystal-operations";
import { editCrystalSymmetry, fillUnitCell, type MoyoAnalyzer } from "./crystal-symmetry";
import { cartesianToFractional, type CellParameters } from "./crystal";
import { wholeMolecules } from "./periodic-bonds";
import { reduceNiggliCell, type IntMatrix3 } from "./symmetry/niggli";
import type { StandaloneWasm } from "./symmetry/wasm-module";
import type { UnitCell } from "./types";

/**
 * One undoable crystal edit: read the source cell, change it, write the result in the
 * source's own format and read that text back to prove it holds exactly the new cell.
 * Edits that move atoms between cells (supercell, Niggli, the space-group edits, fill)
 * keep every finite molecule whole, so bonds that cross a cell face survive.
 */
export type CrystalEdit =
  | { kind: "set-cell"; cell: UnitCell; policy: CoordinatePolicy }
  | { kind: "wrap" }
  | { kind: "standard-orientation" }
  | { kind: "scale-volume"; volume: number }
  | { kind: "supercell"; repeats: [number, number, number] }
  | { kind: "niggli" }
  | { kind: "primitive" | "conventional" | "symmetrize" | "asymmetric-unit"; tolerance: number }
  | { kind: "fill"; hallNumber: number };

export type CrystalEditResult = {
  format: CrystalFormat;
  text: string;
  /** The asymmetric unit of an XYZ or POSCAR source needs a CIF, so it opens as a new document. */
  newDocument: boolean;
  atomCount: number;
  parameters: CellParameters;
  volume: number;
  spaceGroup: { number: number; symbol: string } | null;
  niggliTransform: IntMatrix3 | null;
  addedAtoms: number | null;
};

export type CrystalEngines = { moyo: () => Promise<MoyoAnalyzer>; niggli: () => Promise<StandaloneWasm> };

const RELOCATING = new Set<CrystalEdit["kind"]>(["supercell", "niggli", "primitive", "conventional", "symmetrize", "fill"]);

function verifyReadBack(written: CrystalDocument, expected: CrystalDocument, sameOrder: boolean) {
  const elements = (document: CrystalDocument) => document.atoms.map((atom) => atom.element);
  const a = elements(written), b = elements(expected);
  if (a.length !== b.length || (sameOrder ? a.some((element, index) => element !== b[index]) : [...a].sort().join() !== [...b].sort().join())) {
    throw new Error("The edited cell lost or changed atoms when it was written.");
  }
  const metric = (cell: UnitCell) => cell.map((u) => cell.map((v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  const want = metric(expected.cell), got = metric(written.cell);
  const scale = Math.max(...want.flat().map(Math.abs));
  if (want.some((row, i) => row.some((value, j) => Math.abs(value - got[i][j]) > 1e-6 * scale))) throw new Error("The written cell differs from the edited cell.");
  if (!sameOrder) return;
  // Fractional coordinates, modulo whole cells: a CIF reader wraps every site.
  const moved = written.atoms.some((atom, index) => {
    const f = cartesianToFractional([atom.x, atom.y, atom.z], written.cell), g = cartesianToFractional([expected.atoms[index].x, expected.atoms[index].y, expected.atoms[index].z], expected.cell);
    return f.some((value, axis) => { const d = value - g[axis]; return Math.abs(d - Math.round(d)) > 1e-6; });
  });
  if (moved) throw new Error("The written atoms are not where the edit put them.");
}

export async function runCrystalEdit(engines: CrystalEngines, source: CrystalSource, edit: CrystalEdit): Promise<CrystalEditResult> {
  const document = await readCrystalDocument(source);
  let next: CrystalDocument = document;
  let spaceGroup: CrystalEditResult["spaceGroup"] = null, niggliTransform: IntMatrix3 | null = null, addedAtoms: number | null = null;
  let operations = null as Parameters<typeof writeCrystalCif>[2];
  const keepFlags = (atoms: CrystalDocument["atoms"], cell: UnitCell): CrystalDocument => ({ ...document, atoms, cell });
  const replaced = (sites: Pick<CrystalDocument, "atoms" | "cell" | "species" | "labels">): CrystalDocument => ({ ...document, ...sites, selectiveDynamics: null });
  switch (edit.kind) {
    case "set-cell": {
      // Cartesian positions are the ones on screen: molecules whole across the old cell's faces.
      const model = replaceCell(edit.policy === "cartesian" ? crystalView(document) : document, edit.cell, edit.policy);
      next = keepFlags(model.atoms, model.cell);
      break;
    }
    case "wrap": { const model = wrapAtoms(document); next = keepFlags(model.atoms, model.cell); break; }
    case "standard-orientation": { const model = standardOrientation(document); next = keepFlags(model.atoms, model.cell); break; }
    case "scale-volume": { const model = scaleVolume(document, edit.volume); next = keepFlags(model.atoms, model.cell); break; }
    case "supercell": {
      const model = buildSupercell(document, edit.repeats);
      next = replaced({ atoms: model.atoms, cell: model.cell, species: model.sourceAtomIndices.map((index) => document.species[index]), labels: model.sourceAtomIndices.map((index) => document.labels[index]) });
      break;
    }
    case "niggli": {
      const result = reduceNiggliCell(await engines.niggli(), { cell: document.cell, atoms: document.atoms });
      niggliTransform = result.transform;
      next = keepFlags(result.atoms!.wrappedAtoms, result.cell);
      break;
    }
    case "fill": {
      const filled = fillUnitCell(await engines.moyo(), document, edit.hallNumber);
      spaceGroup = { number: filled.number, symbol: filled.symbol };
      addedAtoms = filled.added;
      next = filled.added ? replaced(filled.sites) : document;
      break;
    }
    default: {
      const result = editCrystalSymmetry(await engines.moyo(), document, edit.tolerance, edit.kind);
      spaceGroup = { number: result.number, symbol: result.symbol };
      operations = result.operations;
      next = replaced(result.sites);
    }
  }
  if (RELOCATING.has(edit.kind)) next = { ...next, atoms: wholeMolecules(next.atoms, next.cell).atoms };
  const asymmetric = edit.kind === "asymmetric-unit";
  const format: CrystalFormat = asymmetric ? "cif" : source.format;
  const text = asymmetric ? writeCrystalCif(next, document.title, operations, spaceGroup) : writeCrystalDocument(format, next);
  const written = await readCrystalDocument({ format, text });
  // The asymmetric unit expands back to the full cell it came from.
  verifyReadBack(written, asymmetric ? document : next, !asymmetric);
  return {
    format, text, newDocument: asymmetric && source.format !== "cif",
    atomCount: next.atoms.length, parameters: cellParametersOf(next.cell), volume: Math.abs(signedVolume(next.cell)),
    spaceGroup, niggliTransform, addedAtoms,
  };
}

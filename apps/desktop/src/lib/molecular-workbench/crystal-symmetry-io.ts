import { readCifCrystal } from "./cif-crystal";
import { runCrystalEdit, type CrystalEdit, type CrystalEditResult, type CrystalEngines } from "./crystal-edit";
import { readCrystalDocument, type CrystalSource } from "./crystal-io";
import { analyzeCrystalSymmetry, spaceGroupSettings, standardizeCrystal, type SpaceGroupSetting, type StandardCellKind, type StandardizedCrystal, type SymmetryAnalysis } from "./crystal-symmetry";

export type { CrystalFormat, CrystalSource } from "./crystal-io";
export type CrystalRequest =
  | { action: "analyze"; source: CrystalSource; tolerance: number }
  | { action: "standardize"; source: CrystalSource; tolerance: number; cell: StandardCellKind; title: string; expectedNumber?: number }
  | { action: "edit"; source: CrystalSource; edit: CrystalEdit }
  | { action: "space-groups" };
export type CrystalResults = { analyze: SymmetryAnalysis; standardize: StandardizedCrystal; edit: CrystalEditResult; "space-groups": SpaceGroupSetting[] };

/** One worker job; engines are instantiated on first use. */
export async function runCrystalRequest<T extends CrystalRequest>(engines: CrystalEngines, request: T): Promise<CrystalResults[T["action"]]> {
  type Result = CrystalResults[T["action"]];
  switch (request.action) {
    case "space-groups": return spaceGroupSettings(await engines.moyo()) as Result;
    case "edit": return await runCrystalEdit(engines, request.source, request.edit) as Result;
    case "analyze": return analyzeCrystalSymmetry(await engines.moyo(), await readCrystalDocument(request.source), request.tolerance) as Result;
    case "standardize": return await standardizeCrystal(await engines.moyo(), await readCrystalDocument(request.source), request.tolerance, request.cell, { title: request.title, readCif: readCifCrystal, expectedNumber: request.expectedNumber }) as Result;
  }
}

// The ESOL reference set as the model code sees it: Burette's own structure
// properties for every molecule, the measured logS, a three-way solubility
// class and the fold each row is held out in. The scikit-learn reference in
// sklearn-reference.json was computed on exactly this table.
import { readFileSync } from "node:fs";

import { MODEL_LIMITS } from "../../../apps/desktop/src/lib/property-models/build";
import { prepareModelInput, type ModelInput, type ModelSourceRow } from "../../../apps/desktop/src/lib/property-models/model-input";
import { assignFolds } from "../../../apps/desktop/src/lib/property-models/random";

export const ESOL_SEED = 24;
export const ESOL_CLASSES = ["high", "low", "medium"];

export function solubilityClass(logS: number) {
  return logS < -4 ? "low" : logS < -2 ? "medium" : "high";
}

export async function loadEngines() {
  const [ocl, rdkitLoader] = await Promise.all([import("openchemlib"), import("@rdkit/rdkit")]);
  const oclNamespace = (ocl as { default?: typeof ocl }).default ?? ocl;
  oclNamespace.Resources.registerFromNodejs();
  return { ocl: oclNamespace, rdkit: await (rdkitLoader as unknown as { default: () => Promise<unknown> }).default() };
}

export function esolRows(): ModelSourceRow[] {
  const lines = readFileSync(new URL("./esol.csv", import.meta.url), "utf8").trim().split("\n").slice(1);
  return lines.map((line, index) => {
    const comma = line.lastIndexOf(",");
    return { index, name: `Molecule ${index + 1}`, smiles: line.slice(0, comma), molblock: null, target: Number(line.slice(comma + 1)), values: [] };
  });
}

export async function esolInput(): Promise<{ input: ModelInput; fold: Int32Array }> {
  const input = await prepareModelInput(esolRows(), "regression", "properties", await loadEngines());
  return { input, fold: assignFolds(input.rows.length, MODEL_LIMITS.folds, ESOL_SEED) };
}

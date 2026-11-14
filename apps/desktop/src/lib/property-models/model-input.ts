import {
  computeRowProperties,
  morganFingerprint,
  SIMILARITY_FINGERPRINT_SETTINGS,
  type DerivedComputeEngines,
} from "../derived-column-compute.mjs";
import { ModelProblem, modelSizeProblem, type ModelTask } from "./build";
import type { NeighbourMetric } from "./neighbours";

/**
 * The structure properties a model is built on: the numeric Calculate
 * Properties columns, without the two scores that scan a fragment library per
 * molecule and the exact mass that repeats the molecular weight.
 */
export const MODEL_PROPERTY_IDS = [
  "cLogP", "cLogS", "HAcceptors", "HDonors", "TPSA", "RotatableBonds", "StereoCenters",
  "MolWeight", "HeavyAtoms", "Heteroatoms", "Rings", "AromaticRings", "SaturatedRings",
  "Heterocycles", "SpiroAtoms", "BridgeheadAtoms", "FractionCsp3", "AmideBonds",
];

/** Where the features come from: computed from each structure, or read from the row's own numeric columns. */
export type ModelDescriptors = "properties" | "fingerprint" | "columns";

export type ModelSourceRow = {
  /** The grid's row index. */
  index: number;
  name: string;
  smiles: string | null;
  molblock: string | null;
  /** The target cell: a number for a numeric column, text for a categorical one, null when empty. */
  target: string | number | null;
  /** The chosen numeric columns, for the "columns" descriptors. */
  values: Array<number | null>;
};

export type ModelInput = {
  /** The rows that have every descriptor, in the order of `features` and `target`. */
  rows: ModelSourceRow[];
  features: Float64Array;
  featureCount: number;
  /** The known value or class index per row; NaN where the target cell is empty. */
  target: Float64Array;
  /** Category labels by class index; empty for regression. */
  classes: string[];
  metric: NeighbourMetric;
  /** Rows left out because a descriptor could not be computed or read. */
  skippedRows: number;
};

const INPUT_BATCH = 50;

/**
 * Turns collection rows into the matrix a model trains on. Structure
 * descriptors are computed here, in batches that yield to the event loop.
 */
export async function prepareModelInput(
  source: ModelSourceRow[],
  task: ModelTask,
  descriptors: ModelDescriptors,
  engines: DerivedComputeEngines | null,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<ModelInput> {
  const featureCount = descriptors === "properties" ? MODEL_PROPERTY_IDS.length
    : descriptors === "fingerprint" ? SIMILARITY_FINGERPRINT_SETTINGS.fplen
      : source[0]?.values.length ?? 0;
  const sizeProblem = modelSizeProblem(source.length, featureCount);
  if (sizeProblem) throw new ModelProblem(sizeProblem);
  const features = new Float64Array(source.length * featureCount);
  const rows: ModelSourceRow[] = [];
  const describe = (row: ModelSourceRow, into: Float64Array): boolean => {
    if (descriptors === "columns") {
      return row.values.every((value, feature) => {
        if (value === null || !Number.isFinite(value)) return false;
        into[feature] = value;
        return true;
      });
    }
    if (descriptors === "properties") {
      const computed = computeRowProperties(engines!, row, MODEL_PROPERTY_IDS);
      return MODEL_PROPERTY_IDS.every((id, feature) => {
        const value = computed[id]?.valueReal;
        if (value === undefined || !Number.isFinite(value)) return false;
        into[feature] = value;
        return true;
      });
    }
    const structure = row.molblock?.trim() ? row.molblock : row.smiles?.trim();
    if (!structure) return false;
    try {
      const words = morganFingerprint(engines!.rdkit, structure);
      for (let bit = 0; bit < featureCount; bit++) into[bit] = (words[bit >>> 5] >>> (bit & 31)) & 1;
      return true;
    } catch {
      return false;
    }
  };

  for (let start = 0; start < source.length; start += INPUT_BATCH) {
    if (options.signal?.aborted) throw new DOMException("Calculation cancelled.", "AbortError");
    for (const row of source.slice(start, start + INPUT_BATCH)) {
      // Each row is written at the next free slot; a row that fails is overwritten by the next one.
      const slot = features.subarray(rows.length * featureCount, (rows.length + 1) * featureCount);
      if (describe(row, slot)) rows.push(row);
    }
    options.onProgress?.(Math.min(start + INPUT_BATCH, source.length), source.length);
    if (descriptors !== "columns") await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const classes = task === "classification"
    ? [...new Set(rows.flatMap((row) => row.target === null ? [] : [String(row.target)]))].sort()
    : [];
  const classIndex = new Map(classes.map((label, index) => [label, index]));
  const target = Float64Array.from(rows, (row) => {
    if (row.target === null) return Number.NaN;
    return task === "classification" ? classIndex.get(String(row.target))! : Number(row.target);
  });
  return {
    rows,
    features: features.slice(0, rows.length * featureCount),
    featureCount,
    target,
    classes,
    metric: descriptors === "fingerprint" ? "tanimoto" : "euclidean",
    skippedRows: source.length - rows.length,
  };
}

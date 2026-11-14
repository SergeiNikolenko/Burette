import { forestPredictions, rankFeatures, type FeatureRanks } from "./forest";
import { nearestRows, neighbourSpace, type NeighbourMetric } from "./neighbours";
import { fitPls, predictPls } from "./pls";
import { assignFolds } from "./random";

export type ModelMethod = "knn" | "pls" | "forest";
export type ModelTask = "regression" | "classification";

/** What one build may hold in memory and finish while the user waits. */
export const MODEL_LIMITS = {
  rows: 20_000,
  features: 2_048,
  cells: 8_000_000,
  classes: 50,
  trainingRows: 10,
  folds: 5,
} as const;

/** The one number each method is tuned by, with its default and allowed range. */
export const MODEL_METHODS: Record<ModelMethod, { label: string; setting: string; initial: number; min: number; max: number }> = {
  knn: { label: "Nearest neighbours", setting: "Neighbours", initial: 5, min: 1, max: 50 },
  pls: { label: "Partial least squares", setting: "Components", initial: 5, min: 1, max: 50 },
  forest: { label: "Random forest", setting: "Trees", initial: 100, min: 10, max: 500 },
};

export type PropertyModelRequest = {
  /** rowCount x featureCount, row by row; every value finite. */
  features: Float64Array;
  rowCount: number;
  featureCount: number;
  /** Per row: the known value (a class index for classification) or NaN where the model should predict. */
  target: Float64Array;
  task: ModelTask;
  /** Number of classes; 0 for regression. */
  classCount: number;
  method: ModelMethod;
  setting: number;
  metric: NeighbourMetric;
  seed: number;
};

export type PropertyModelResult = {
  trainedRows: number;
  /** Cross-validated R² (regression) or accuracy (classification) over the rows with a known value. */
  score: number;
  /** Cross-validated root-mean-square error; null for classification. */
  error: number | null;
  /**
   * Per row. A row with a known value gets the prediction of the fold model
   * that never saw it; a row without one gets the model trained on every known
   * value.
   */
  predictions: Float64Array;
};

/** An input the user can fix; its message is written for the dialog. */
export class ModelProblem extends Error {}

/** Why the method's setting is not usable; null when it is. */
export function modelSettingProblem(method: ModelMethod, setting: number): string | null {
  const range = MODEL_METHODS[method];
  return Number.isInteger(setting) && setting >= range.min && setting <= range.max
    ? null
    : `${range.setting} must be a whole number from ${range.min} to ${range.max}.`;
}

/** Why a table of this shape is too large to model, in words for the dialog; null when it fits. */
export function modelSizeProblem(rowCount: number, featureCount: number): string | null {
  if (rowCount > MODEL_LIMITS.rows) return `Build model works on up to ${MODEL_LIMITS.rows.toLocaleString()} rows.`;
  if (featureCount < 1) return "Choose at least one descriptor.";
  if (featureCount > MODEL_LIMITS.features) return `Build model works on up to ${MODEL_LIMITS.features.toLocaleString()} descriptors.`;
  if (rowCount * featureCount > MODEL_LIMITS.cells) {
    return `With ${featureCount.toLocaleString()} descriptors, Build model works on up to ${Math.floor(MODEL_LIMITS.cells / featureCount).toLocaleString()} rows.`;
  }
  return null;
}

/** Why this input cannot be modelled, in words for the dialog; null when it can. */
export function propertyModelProblem(request: PropertyModelRequest): string | null {
  const { rowCount, featureCount, target, task, classCount, method, setting } = request;
  const sizeProblem = modelSizeProblem(rowCount, featureCount);
  if (sizeProblem) return sizeProblem;
  if (request.features.length !== rowCount * featureCount || target.length !== rowCount) return "The descriptors do not match the rows.";
  const known = target.filter((value) => !Number.isNaN(value));
  if (known.length < MODEL_LIMITS.trainingRows) return `Build model needs at least ${MODEL_LIMITS.trainingRows} rows with a value.`;
  if (task === "classification" && (classCount < 2 || classCount > MODEL_LIMITS.classes)) {
    return classCount < 2 ? "The column holds a single category." : `Build model works on up to ${MODEL_LIMITS.classes} categories.`;
  }
  if (task === "regression" && known.every((value) => value === known[0])) return "The column holds a single value.";
  return modelSettingProblem(method, setting);
}

/**
 * Trains the chosen model with 5-fold cross-validation and predicts every row.
 * The same request and seed always give the same result.
 */
export function buildPropertyModel(request: PropertyModelRequest, onProgress?: (fraction: number) => void): PropertyModelResult {
  const problem = propertyModelProblem(request);
  if (problem) throw new ModelProblem(problem);
  const { features, rowCount, featureCount, target, task, classCount, method, setting, metric, seed } = request;
  const outputs = task === "classification" ? classCount : 1;

  const known: number[] = [];
  const unknown: number[] = [];
  for (let row = 0; row < rowCount; row++) (Number.isNaN(target[row]) ? unknown : known).push(row);
  const fold = assignFolds(known.length, MODEL_LIMITS.folds, seed);
  const fits: Array<{ train: Int32Array; test: Int32Array }> = [];
  for (let held = 0; held < MODEL_LIMITS.folds; held++) {
    fits.push({
      train: Int32Array.from(known.filter((_, index) => fold[index] !== held)),
      test: Int32Array.from(known.filter((_, index) => fold[index] === held)),
    });
  }
  if (unknown.length) fits.push({ train: Int32Array.from(known), test: Int32Array.from(unknown) });

  let ranks: FeatureRanks | null = null;
  const predictions = new Float64Array(rowCount).fill(Number.NaN);
  const response = new Float64Array(outputs);
  const votes = new Float64Array(outputs);
  const strongest = (scores: Float64Array) => {
    let best = 0;
    for (let label = 1; label < scores.length; label++) if (scores[label] > scores[best]) best = label;
    return best;
  };

  fits.forEach(({ train, test }, fit) => {
    const report = (part: number) => onProgress?.((fit + part) / fits.length);
    report(0);
    if (method === "knn") {
      const space = neighbourSpace(features, rowCount, featureCount, metric, train);
      test.forEach((row, index) => {
        const nearest = nearestRows(space, row, train, setting).rows;
        if (task === "classification") {
          votes.fill(0);
          for (const neighbour of nearest) votes[target[neighbour]] += 1;
          predictions[row] = strongest(votes);
        } else {
          let sum = 0;
          for (const neighbour of nearest) sum += target[neighbour];
          predictions[row] = sum / nearest.length;
        }
        if ((index & 63) === 63) report(index / test.length);
      });
    } else if (method === "pls") {
      const responses = new Float64Array(train.length * outputs);
      train.forEach((row, index) => {
        if (task === "classification") responses[index * outputs + target[row]] = 1;
        else responses[index] = target[row];
      });
      const model = fitPls(features, featureCount, train, responses, outputs, setting, (done, total) => report(done / total));
      for (const row of test) {
        predictPls(model, features, row, response);
        predictions[row] = task === "classification" ? strongest(response) : response[0];
      }
    } else {
      ranks ??= rankFeatures(features, rowCount, featureCount);
      const predicted = forestPredictions({
        features, rowCount, featureCount, ranks, target,
        classCount: task === "classification" ? classCount : 0,
        fitRows: train,
        predictRows: test,
        trees: setting,
        tryFeatures: Math.max(1, Math.floor(task === "classification" ? Math.sqrt(featureCount) : featureCount / 3)),
        seed: (seed ^ Math.imul(fit + 1, 0x85ebca6b)) >>> 0,
        onTree: (done) => report(done / setting),
      });
      test.forEach((row, index) => { predictions[row] = predicted[index]; });
    }
  });
  onProgress?.(1);

  if (task === "classification") {
    const correct = known.reduce((count, row) => count + (predictions[row] === target[row] ? 1 : 0), 0);
    return { trainedRows: known.length, score: correct / known.length, error: null, predictions };
  }
  const mean = known.reduce((sum, row) => sum + target[row], 0) / known.length;
  let residual = 0;
  let total = 0;
  for (const row of known) {
    residual += (target[row] - predictions[row]) ** 2;
    total += (target[row] - mean) ** 2;
  }
  return { trainedRows: known.length, score: 1 - residual / total, error: Math.sqrt(residual / known.length), predictions };
}

// Property models against scikit-learn. The reference numbers in
// fixtures/property-models/sklearn-reference.json were computed on the ESOL
// solubility set with Burette's own descriptor matrix and the same folds; the
// README next to the fixture has the exact commands.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  buildPropertyModel,
  MODEL_LIMITS,
  propertyModelProblem,
  type ModelMethod,
  type PropertyModelRequest,
} from "../apps/desktop/src/lib/property-models/build";
import { prepareModelInput, type ModelSourceRow } from "../apps/desktop/src/lib/property-models/model-input";
import { runPropertyModel } from "../apps/desktop/src/lib/property-models/model-task";
import { nearestRows, neighbourSpace } from "../apps/desktop/src/lib/property-models/neighbours";
import { fitPls, predictPls } from "../apps/desktop/src/lib/property-models/pls";
import { assignFolds, seededRandom } from "../apps/desktop/src/lib/property-models/random";
import { ESOL_CLASSES, ESOL_SEED, esolInput, solubilityClass } from "./fixtures/property-models/esol";

const reference = JSON.parse(readFileSync(new URL("./fixtures/property-models/sklearn-reference.json", import.meta.url), "utf8"));
const { input: esol, fold: esolFold } = await esolInput();
const esolRequest = (method: ModelMethod, setting: number): PropertyModelRequest => ({
  features: esol.features,
  rowCount: esol.rows.length,
  featureCount: esol.featureCount,
  target: esol.target,
  task: "regression",
  classCount: 0,
  method,
  setting,
  metric: "euclidean",
  seed: ESOL_SEED,
});
const esolClasses = (method: ModelMethod, setting: number): PropertyModelRequest => ({
  ...esolRequest(method, setting),
  target: Float64Array.from(esol.target, (logS) => ESOL_CLASSES.indexOf(solubilityClass(logS))),
  task: "classification",
  classCount: ESOL_CLASSES.length,
});

test("the reference was computed on this descriptor matrix and these folds", () => {
  expect([esol.rows.length, esol.featureCount, esol.skippedRows]).toEqual([reference.rows, reference.features, 0]);
  expect(Array.from(esolFold.slice(0, 2))).toEqual([1, 3]);
  const sizes = Array.from({ length: MODEL_LIMITS.folds }, (_, held) => esolFold.filter((fold) => fold === held).length);
  expect(sizes).toEqual([226, 226, 226, 225, 225]);
  expect(assignFolds(esol.rows.length, MODEL_LIMITS.folds, ESOL_SEED)).toEqual(esolFold);
  expect(assignFolds(esol.rows.length, MODEL_LIMITS.folds, ESOL_SEED + 1)).not.toEqual(esolFold);
});

test("nearest neighbours and random forest reproduce scikit-learn's cross-validated R² on ESOL within 0.02", () => {
  const knn = buildPropertyModel(esolRequest("knn", 5));
  expect(Math.abs(knn.score - reference.regression.knn.r2)).toBeLessThan(0.02);
  expect(Math.abs(knn.error! - reference.regression.knn.rmse)).toBeLessThan(0.02);
  const forest = buildPropertyModel(esolRequest("forest", 100));
  expect(Math.abs(forest.score - reference.regression.forest.r2)).toBeLessThan(0.02);
  expect(Math.abs(forest.error! - reference.regression.forest.rmse)).toBeLessThan(0.03);
  expect(knn.trainedRows).toBe(1128);
  // The forest is the better model on this set, as it is in scikit-learn.
  expect(forest.score).toBeGreaterThan(knn.score + 0.02);
});

test("partial least squares gives scikit-learn's PLSRegression predictions", () => {
  const everyRow = Int32Array.from(esol.rows, (_, row) => row);
  const model = fitPls(esol.features, esol.featureCount, everyRow, esol.target, 1, 5);
  const predicted = new Float64Array(1);
  let worst = 0;
  for (const row of everyRow) {
    predictPls(model, esol.features, row, predicted);
    worst = Math.max(worst, Math.abs(predicted[0] - reference.regression.pls.fitted[row]));
  }
  expect(worst).toBeLessThan(1e-8);
  const crossValidated = buildPropertyModel(esolRequest("pls", 5));
  expect(Math.abs(crossValidated.score - reference.regression.pls.r2)).toBeLessThan(1e-9);
  expect(Math.abs(crossValidated.error! - reference.regression.pls.rmse)).toBeLessThan(1e-9);
});

test("classification accuracy on the three solubility classes matches scikit-learn", () => {
  const knn = buildPropertyModel(esolClasses("knn", 5));
  const forest = buildPropertyModel(esolClasses("forest", 100));
  const pls = buildPropertyModel(esolClasses("pls", 5));
  expect(Math.abs(knn.score - reference.classification.knn.accuracy)).toBeLessThan(0.02);
  expect(Math.abs(forest.score - reference.classification.forest.accuracy)).toBeLessThan(0.02);
  expect(Math.abs(pls.score - reference.classification.pls.accuracy)).toBeLessThan(0.005);
  expect(knn.error).toBeNull();
  expect(new Set(forest.predictions)).toEqual(new Set([0, 1, 2]));
});

// Two activity classes separated along the first column, a noise column, six
// rows whose class is unknown and one row that lacks a descriptor.
function categorySource(): ModelSourceRow[] {
  const random = seededRandom(7);
  const rows: ModelSourceRow[] = Array.from({ length: 46 }, (_, index) => {
    const active = index % 2 === 0;
    return {
      index: index * 3,
      name: `Row ${index + 1}`,
      smiles: null,
      molblock: null,
      target: index % 8 === 5 ? null : active ? "active" : "inactive",
      values: [(active ? 4 : -4) + random(), random()],
    };
  });
  rows[10].values = [1, null];
  return rows;
}

test("a small categorical column trains every method and predicts the rows without a category", async () => {
  const source = categorySource();
  const input = await prepareModelInput(source, "classification", "columns", null);
  expect(input.classes).toEqual(["active", "inactive"]);
  expect([input.rows.length, input.skippedRows, input.featureCount, input.metric]).toEqual([45, 1, 2, "euclidean"]);
  const unknown = input.rows.flatMap((row, index) => row.target === null ? [index] : []);
  expect(unknown).toHaveLength(6);
  for (const [method, setting] of [["knn", 3], ["pls", 2], ["forest", 20]] as const) {
    const model = buildPropertyModel({
      features: input.features, rowCount: 45, featureCount: 2, target: input.target,
      task: "classification", classCount: 2, method, setting, metric: input.metric, seed: 3,
    });
    expect(model.score).toBe(1);
    expect(model.trainedRows).toBe(39);
    for (const row of unknown) expect(input.classes[model.predictions[row]]).toBe(input.features[row * 2] > 0 ? "active" : "inactive");
  }
});

test("rows without a value are predicted by the full model and never trained on; the seed fixes the result", () => {
  const target = Float64Array.from(esol.target);
  const hidden = [3, 77, 400, 1127];
  for (const row of hidden) target[row] = Number.NaN;
  const request = { ...esolRequest("forest", 30), target };
  const model = buildPropertyModel(request);
  expect(model.trainedRows).toBe(1124);
  expect(model.predictions.every(Number.isFinite)).toBe(true);
  // The hidden values were never seen, yet a model this good lands near them.
  for (const row of hidden) expect(Math.abs(model.predictions[row] - esol.target[row])).toBeLessThan(2.5);
  expect(buildPropertyModel(request).predictions).toEqual(model.predictions);
  expect(buildPropertyModel({ ...request, seed: ESOL_SEED + 1 }).predictions).not.toEqual(model.predictions);
  // Hiding other values must not change what the caller passed in.
  expect(target.filter(Number.isNaN)).toHaveLength(4);
});

test("neighbours are the true nearest training rows", () => {
  const { features, featureCount } = esol;
  const rowCount = esol.rows.length;
  const training = Int32Array.from({ length: 900 }, (_, row) => row);
  const space = neighbourSpace(features, rowCount, featureCount, "euclidean", training);
  // Independent check: standardise by the training rows, then sort every distance.
  const column = (feature: number) => Array.from(training, (row) => features[row * featureCount + feature]);
  const scale = Array.from({ length: featureCount }, (_, feature) => {
    const values = column(feature);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) || 1;
  });
  const distance = (left: number, right: number) => Math.hypot(...scale.map((deviation, feature) =>
    (features[left * featureCount + feature] - features[right * featureCount + feature]) / deviation));
  for (const query of [0, 450, 899, 950, 1127]) {
    const smallest = Array.from(training).filter((row) => row !== query)
      .map((row) => distance(query, row))
      .sort((left, right) => left - right)
      .slice(0, 5);
    const nearest = nearestRows(space, query, training, 5);
    // ESOL repeats molecules, so two rows can tie: the five returned rows must
    // be training rows at exactly the five smallest distances, nearest first.
    expect(nearest.rows).toHaveLength(5);
    expect(new Set(nearest.rows).size).toBe(5);
    nearest.rows.forEach((row, index) => {
      expect(row).toBeLessThan(900);
      expect(row).not.toBe(query);
      expect(distance(query, row)).toBeCloseTo(smallest[index], 10);
      expect(nearest.distances[index]).toBeCloseTo(smallest[index], 10);
    });
  }
  expect(nearestRows(space, 0, Int32Array.of(0, 5, 9), 5).rows).toHaveLength(2);
});

test("fingerprint neighbours rank by Tanimoto similarity", () => {
  const random = seededRandom(11);
  const rowCount = 60;
  const featureCount = 70;
  const bits = Float64Array.from({ length: rowCount * featureCount }, () => random() < 0.3 ? 1 : 0);
  const everyRow = Int32Array.from({ length: rowCount }, (_, row) => row);
  const space = neighbourSpace(bits, rowCount, featureCount, "tanimoto", everyRow);
  const similarity = (left: number, right: number) => {
    let shared = 0;
    let union = 0;
    for (let bit = 0; bit < featureCount; bit++) {
      const a = bits[left * featureCount + bit];
      const b = bits[right * featureCount + bit];
      shared += a * b;
      union += Math.max(a, b);
    }
    return shared / union;
  };
  for (const query of [0, 31, 59]) {
    const expected = Array.from(everyRow).filter((row) => row !== query)
      .map((row) => ({ row, distance: 1 - similarity(query, row) }))
      .sort((left, right) => left.distance - right.distance || left.row - right.row)
      .slice(0, 4);
    const nearest = nearestRows(space, query, everyRow, 4);
    expect(Array.from(nearest.rows)).toEqual(expected.map((entry) => entry.row));
    nearest.distances.forEach((value, index) => expect(value).toBeCloseTo(expected[index].distance, 12));
  }
});

test("oversized or unusable inputs are refused in the dialog's words", () => {
  const request = esolRequest("knn", 5);
  expect(propertyModelProblem(request)).toBeNull();
  expect(propertyModelProblem({ ...request, rowCount: MODEL_LIMITS.rows + 1 })).toBe("Build model works on up to 20,000 rows.");
  expect(propertyModelProblem({ ...request, rowCount: 5_000, featureCount: 2_048 })).toBe("With 2,048 descriptors, Build model works on up to 3,906 rows.");
  expect(propertyModelProblem({ ...request, featureCount: 4_096 })).toBe("Build model works on up to 2,048 descriptors.");
  expect(propertyModelProblem({ ...request, target: esol.target.map((value, row) => row < 9 ? value : Number.NaN) }))
    .toBe("Build model needs at least 10 rows with a value.");
  expect(propertyModelProblem({ ...request, target: esol.target.map(() => 1) })).toBe("The column holds a single value.");
  expect(propertyModelProblem({ ...esolClasses("knn", 5), classCount: 1 })).toBe("The column holds a single category.");
  expect(propertyModelProblem({ ...request, setting: 0 })).toBe("Neighbours must be a whole number from 1 to 50.");
  expect(propertyModelProblem({ ...request, method: "forest", setting: 2.5 })).toBe("Trees must be a whole number from 10 to 500.");
  expect(() => buildPropertyModel({ ...request, setting: 0 })).toThrow("Neighbours must be a whole number from 1 to 50.");
});

test("the worker returns the same model, reports progress and stops when asked", async () => {
  const request = esolRequest("forest", 40);
  const fractions: number[] = [];
  const result = await runPropertyModel(request, { onProgress: (fraction) => fractions.push(fraction) });
  expect(result.predictions).toEqual(buildPropertyModel(request).predictions);
  expect(result.score).toBeGreaterThan(0.9);
  expect(fractions.length).toBeGreaterThan(0);
  expect(fractions.every((fraction, index) => fraction >= 0 && fraction <= 1 && (index === 0 || fraction >= fractions[index - 1]))).toBe(true);
  // The request still owns its matrix after the worker took a copy.
  expect(request.features.length).toBe(esol.rows.length * esol.featureCount);

  const controller = new AbortController();
  const stopped = runPropertyModel(esolRequest("forest", 500), { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await expect(stopped).rejects.toThrow("Calculation cancelled.");
});

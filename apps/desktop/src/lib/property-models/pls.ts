export type PlsModel = {
  featureCount: number;
  outputs: number;
  center: Float64Array;
  /** featureCount x outputs, in the units of the original features and responses. */
  coefficients: Float64Array;
  intercept: Float64Array;
};

const WEIGHT_TOLERANCE = 1e-6;
const MAX_ITERATIONS = 500;

function centreAndScale(values: Float64Array, rows: number, columns: number) {
  const mean = new Float64Array(columns);
  const scale = new Float64Array(columns);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) mean[column] += values[row * columns + column];
  for (let column = 0; column < columns; column++) mean[column] /= rows;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const centred = values[row * columns + column] - mean[column];
      values[row * columns + column] = centred;
      scale[column] += centred * centred;
    }
  }
  // Sample standard deviation; a column that never varies keeps scale 1.
  for (let column = 0; column < columns; column++) {
    const deviation = Math.sqrt(scale[column] / (rows - 1));
    scale[column] = deviation > 0 ? deviation : 1;
  }
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) values[row * columns + column] /= scale[column];
  return { mean, scale };
}

/**
 * Partial least squares regression by NIPALS on centred, unit-variance data.
 * `responses` is fitRows.length x outputs; one output is PLS1, a one-hot class
 * matrix gives PLS discriminant analysis.
 */
export function fitPls(
  features: Float64Array,
  featureCount: number,
  fitRows: Int32Array,
  responses: Float64Array,
  outputs: number,
  components: number,
  onComponent?: (done: number, total: number) => void,
): PlsModel {
  const rows = fitRows.length;
  const x = new Float64Array(rows * featureCount);
  fitRows.forEach((row, index) => x.set(features.subarray(row * featureCount, (row + 1) * featureCount), index * featureCount));
  const y = responses.slice();
  const xStats = centreAndScale(x, rows, featureCount);
  const yStats = centreAndScale(y, rows, outputs);

  const total = Math.max(1, Math.min(components, featureCount, rows - 1));
  const rotations: Float64Array[] = [];
  const xLoadings: Float64Array[] = [];
  const yLoadings: Float64Array[] = [];
  const weights = new Float64Array(featureCount);
  const previous = new Float64Array(featureCount);
  const xScores = new Float64Array(rows);
  const yScores = new Float64Array(rows);
  const yWeights = new Float64Array(outputs);

  for (let component = 0; component < total; component++) {
    // Start from the first response that still has something left to explain.
    let start = -1;
    for (let output = 0; output < outputs && start < 0; output++) {
      for (let row = 0; row < rows; row++) {
        if (Math.abs(y[row * outputs + output]) >= 10 * Number.EPSILON) { start = output; break; }
      }
    }
    if (start < 0) break;
    for (let row = 0; row < rows; row++) yScores[row] = y[row * outputs + start];

    let scoreNorm = 0;
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      let yScoreNorm = 0;
      for (let row = 0; row < rows; row++) yScoreNorm += yScores[row] * yScores[row];
      weights.fill(0);
      for (let row = 0; row < rows; row++) {
        const score = yScores[row];
        if (score === 0) continue;
        const offset = row * featureCount;
        for (let feature = 0; feature < featureCount; feature++) weights[feature] += x[offset + feature] * score;
      }
      let weightNorm = 0;
      for (let feature = 0; feature < featureCount; feature++) {
        weights[feature] /= yScoreNorm;
        weightNorm += weights[feature] * weights[feature];
      }
      weightNorm = Math.sqrt(weightNorm) + Number.EPSILON;
      for (let feature = 0; feature < featureCount; feature++) weights[feature] /= weightNorm;

      scoreNorm = 0;
      for (let row = 0; row < rows; row++) {
        const offset = row * featureCount;
        let score = 0;
        for (let feature = 0; feature < featureCount; feature++) score += x[offset + feature] * weights[feature];
        xScores[row] = score;
        scoreNorm += score * score;
      }
      if (scoreNorm === 0) break;
      yWeights.fill(0);
      for (let row = 0; row < rows; row++) {
        for (let output = 0; output < outputs; output++) yWeights[output] += y[row * outputs + output] * xScores[row];
      }
      let yWeightNorm = Number.EPSILON;
      for (let output = 0; output < outputs; output++) {
        yWeights[output] /= scoreNorm;
        yWeightNorm += yWeights[output] * yWeights[output];
      }
      for (let row = 0; row < rows; row++) {
        let score = 0;
        for (let output = 0; output < outputs; output++) score += y[row * outputs + output] * yWeights[output];
        yScores[row] = score / yWeightNorm;
      }
      if (outputs === 1) break;
      let change = 0;
      for (let feature = 0; feature < featureCount; feature++) {
        const delta = weights[feature] - previous[feature];
        change += delta * delta;
      }
      if (iteration > 0 && change < WEIGHT_TOLERANCE) break;
      previous.set(weights);
    }
    if (scoreNorm === 0) break;

    const xLoading = new Float64Array(featureCount);
    const yLoading = new Float64Array(outputs);
    for (let row = 0; row < rows; row++) {
      const score = xScores[row];
      const offset = row * featureCount;
      for (let feature = 0; feature < featureCount; feature++) xLoading[feature] += x[offset + feature] * score;
      for (let output = 0; output < outputs; output++) yLoading[output] += y[row * outputs + output] * score;
    }
    for (let feature = 0; feature < featureCount; feature++) xLoading[feature] /= scoreNorm;
    for (let output = 0; output < outputs; output++) yLoading[output] /= scoreNorm;
    for (let row = 0; row < rows; row++) {
      const score = xScores[row];
      const offset = row * featureCount;
      for (let feature = 0; feature < featureCount; feature++) x[offset + feature] -= score * xLoading[feature];
      for (let output = 0; output < outputs; output++) y[row * outputs + output] -= score * yLoading[output];
    }

    // Rotation that maps the undeflated features onto this score: w minus its
    // overlap with every earlier loading.
    const rotation = Float64Array.from(weights);
    for (let earlier = 0; earlier < rotations.length; earlier++) {
      let overlap = 0;
      for (let feature = 0; feature < featureCount; feature++) overlap += xLoadings[earlier][feature] * weights[feature];
      for (let feature = 0; feature < featureCount; feature++) rotation[feature] -= overlap * rotations[earlier][feature];
    }
    rotations.push(rotation);
    xLoadings.push(xLoading);
    yLoadings.push(yLoading);
    onComponent?.(component + 1, total);
  }

  const coefficients = new Float64Array(featureCount * outputs);
  for (let component = 0; component < rotations.length; component++) {
    for (let feature = 0; feature < featureCount; feature++) {
      const rotation = rotations[component][feature] / xStats.scale[feature];
      for (let output = 0; output < outputs; output++) {
        coefficients[feature * outputs + output] += rotation * yLoadings[component][output] * yStats.scale[output];
      }
    }
  }
  return { featureCount, outputs, center: xStats.mean, coefficients, intercept: yStats.mean };
}

/** Writes the model's response for one row of `features` into `into`. */
export function predictPls(model: PlsModel, features: Float64Array, row: number, into: Float64Array) {
  into.set(model.intercept);
  const offset = row * model.featureCount;
  for (let feature = 0; feature < model.featureCount; feature++) {
    const centred = features[offset + feature] - model.center[feature];
    if (centred === 0) continue;
    for (let output = 0; output < model.outputs; output++) into[output] += centred * model.coefficients[feature * model.outputs + output];
  }
}

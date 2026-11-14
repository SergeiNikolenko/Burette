import { seededRandom } from "./random";

/**
 * Every feature value replaced by its position among the feature's distinct
 * values, stored feature by feature. Trees only compare values, so splits found
 * on ranks are the splits found on the values, without sorting floats per node.
 *
 * A two-valued feature - a fingerprint bit - also lists the rows that hold its
 * rarer value (`rareRows` from `rareStart[feature]` to `rareStart[feature + 1]`),
 * so a split on it costs the handful of rows that have the bit, not the node.
 */
export type FeatureRanks = {
  ranks: Uint16Array;
  distinct: Int32Array;
  rareRows: Int32Array;
  rareStart: Int32Array;
  /** Per two-valued feature: which rank is the rarer one, and the two values. */
  rareRank: Uint8Array;
  lowValue: Float64Array;
  highValue: Float64Array;
};

export function rankFeatures(features: Float64Array, rowCount: number, featureCount: number): FeatureRanks {
  const ranks = new Uint16Array(rowCount * featureCount);
  const distinct = new Int32Array(featureCount);
  const rare: number[] = [];
  const rareStart = new Int32Array(featureCount + 1);
  const rareRank = new Uint8Array(featureCount);
  const lowValue = new Float64Array(featureCount);
  const highValue = new Float64Array(featureCount);
  const column = new Float64Array(rowCount);
  for (let feature = 0; feature < featureCount; feature++) {
    for (let row = 0; row < rowCount; row++) column[row] = features[row * featureCount + feature];
    const sorted = column.slice().sort();
    let count = 0;
    for (let index = 0; index < rowCount; index++) {
      if (index === 0 || sorted[index] !== sorted[count - 1]) sorted[count++] = sorted[index];
    }
    distinct[feature] = count;
    let upper = 0;
    for (let row = 0; row < rowCount; row++) {
      let low = 0;
      let high = count - 1;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (sorted[middle] < column[row]) low = middle + 1;
        else high = middle;
      }
      ranks[feature * rowCount + row] = low;
      upper += low;
    }
    if (count === 2) {
      rareRank[feature] = upper * 2 <= rowCount ? 1 : 0;
      lowValue[feature] = sorted[0];
      highValue[feature] = sorted[1];
      for (let row = 0; row < rowCount; row++) if (ranks[feature * rowCount + row] === rareRank[feature]) rare.push(row);
    }
    rareStart[feature + 1] = rare.length;
  }
  return { ranks, distinct, rareRows: Int32Array.from(rare), rareStart, rareRank, lowValue, highValue };
}

export type ForestRequest = {
  features: Float64Array;
  rowCount: number;
  featureCount: number;
  ranks: FeatureRanks;
  /** Per row: the value to fit, or the class index when `classCount` is set. */
  target: Float64Array;
  /** 0 for regression. */
  classCount: number;
  fitRows: Int32Array;
  predictRows: Int32Array;
  trees: number;
  /** Features tried at each split. */
  tryFeatures: number;
  seed: number;
  onTree?: (done: number) => void;
};

/**
 * Random forest of fully grown trees on bootstrap samples (Breiman): each split
 * takes the best of `tryFeatures` randomly drawn features by squared-error
 * reduction, which for classes is the Gini criterion. A leaf answers with its
 * mean or its majority class; the forest averages the means or counts the
 * votes. Returns one prediction per `predictRows` entry; no tree is kept.
 */
export function forestPredictions(request: ForestRequest): Float64Array {
  const { features, rowCount, featureCount, target, classCount, fitRows, predictRows } = request;
  const { ranks, distinct, rareRows, rareStart, rareRank, lowValue, highValue } = request.ranks;
  const outputs = Math.max(1, classCount);
  const maxDistinct = distinct.reduce((most, count) => Math.max(most, count), 1);

  const weights = new Uint16Array(rowCount);
  // The node each in-bag row currently sits in; -1 for rows outside the bag.
  const nodeOf = new Int32Array(rowCount);
  const samples = new Int32Array(fitRows.length);
  const featureOrder = Int32Array.from({ length: featureCount }, (_, index) => index);
  const sortKeys = new Float64Array(fitRows.length);
  const binWeight = new Float64Array(maxDistinct);
  const binSums = new Float64Array(maxDistinct * outputs);
  const binRow = new Int32Array(maxDistinct);
  const nodeSums = new Float64Array(outputs);
  const leftSums = new Float64Array(outputs);

  const nodeFeature = new Int32Array(2 * fitRows.length);
  const nodeThreshold = new Float64Array(2 * fitRows.length);
  const nodeLeft = new Int32Array(2 * fitRows.length);
  const nodeRight = new Int32Array(2 * fitRows.length);
  const nodeValue = new Float64Array(2 * fitRows.length);
  const stack: number[] = [];

  const totals = new Float64Array(predictRows.length * outputs);

  for (let tree = 0; tree < request.trees; tree++) {
    const random = seededRandom((request.seed ^ Math.imul(tree + 1, 0x9e3779b1)) >>> 0);
    weights.fill(0);
    for (let draw = 0; draw < fitRows.length; draw++) weights[fitRows[Math.floor(random() * fitRows.length)]] += 1;
    let sampleCount = 0;
    nodeOf.fill(-1);
    for (const row of fitRows) {
      if (weights[row] === 0) continue;
      samples[sampleCount++] = row;
      nodeOf[row] = 0;
    }

    let nodeCount = 1;
    stack.length = 0;
    stack.push(0, sampleCount, 0);
    while (stack.length) {
      const node = stack.pop()!;
      const end = stack.pop()!;
      const start = stack.pop()!;

      nodeSums.fill(0);
      let nodeWeight = 0;
      let low = Infinity;
      let high = -Infinity;
      for (let index = start; index < end; index++) {
        const row = samples[index];
        const weight = weights[row];
        const value = target[row];
        nodeWeight += weight;
        if (classCount) nodeSums[value] += weight;
        else nodeSums[0] += weight * value;
        if (value < low) low = value;
        if (value > high) high = value;
      }
      if (classCount) {
        let best = 0;
        for (let label = 1; label < classCount; label++) if (nodeSums[label] > nodeSums[best]) best = label;
        nodeValue[node] = best;
      } else {
        nodeValue[node] = nodeSums[0] / nodeWeight;
      }
      nodeFeature[node] = -1;
      if (end - start < 2 || low === high) continue;

      let bestScore = -Infinity;
      let bestFeature = -1;
      let bestRank = 0;
      let bestThreshold = 0;
      // Called once a candidate's left side is complete: every value up to
      // `below` goes left, `above` is the next value up.
      const consider = (feature: number, leftWeight: number, rank: number, below: number, above: number) => {
        let score = 0;
        const rightWeight = nodeWeight - leftWeight;
        for (let output = 0; output < outputs; output++) {
          const left = leftSums[output];
          const right = nodeSums[output] - left;
          score += left * left / leftWeight + right * right / rightWeight;
        }
        if (score <= bestScore) return;
        const middle = below + (above - below) / 2;
        bestScore = score;
        bestFeature = feature;
        bestRank = rank;
        // Halfway between the two values, unless rounding lands on the upper one.
        bestThreshold = middle === above ? below : middle;
      };

      for (let tried = 0; tried < featureCount; tried++) {
        if (tried >= request.tryFeatures && bestFeature >= 0) break;
        const pick = tried + Math.floor(random() * (featureCount - tried));
        const feature = featureOrder[pick];
        featureOrder[pick] = featureOrder[tried];
        featureOrder[tried] = feature;
        const featureRanks = feature * rowCount;
        const bins = distinct[feature];
        if (bins < 2) continue;
        leftSums.fill(0);
        let leftWeight = 0;

        if (bins === 2 && rareStart[feature + 1] - rareStart[feature] < end - start) {
          for (let index = rareStart[feature]; index < rareStart[feature + 1]; index++) {
            const row = rareRows[index];
            if (nodeOf[row] !== node) continue;
            const weight = weights[row];
            leftWeight += weight;
            if (classCount) leftSums[target[row]] += weight;
            else leftSums[0] += weight * target[row];
          }
          if (leftWeight === 0 || leftWeight === nodeWeight) continue;
          if (rareRank[feature] === 1) {
            // The rare rows are the upper side; the left side is everything else.
            leftWeight = nodeWeight - leftWeight;
            for (let output = 0; output < outputs; output++) leftSums[output] = nodeSums[output] - leftSums[output];
          }
          consider(feature, leftWeight, 0, lowValue[feature], highValue[feature]);
        } else if (bins <= 4 * (end - start)) {
          binWeight.fill(0, 0, bins);
          binSums.fill(0, 0, bins * outputs);
          for (let index = start; index < end; index++) {
            const row = samples[index];
            const bin = ranks[featureRanks + row];
            const weight = weights[row];
            binWeight[bin] += weight;
            if (classCount) binSums[bin * outputs + target[row]] += weight;
            else binSums[bin] += weight * target[row];
            binRow[bin] = row;
          }
          let previous = -1;
          for (let bin = 0; bin < bins; bin++) {
            if (binWeight[bin] === 0) continue;
            if (previous >= 0) {
              consider(feature, leftWeight, previous, features[binRow[previous] * featureCount + feature], features[binRow[bin] * featureCount + feature]);
            }
            leftWeight += binWeight[bin];
            for (let output = 0; output < outputs; output++) leftSums[output] += binSums[bin * outputs + output];
            previous = bin;
          }
        } else {
          const count = end - start;
          for (let index = 0; index < count; index++) {
            const row = samples[start + index];
            sortKeys[index] = ranks[featureRanks + row] * rowCount + row;
          }
          sortKeys.subarray(0, count).sort();
          let previousRank = -1;
          let previousRow = -1;
          for (let index = 0; index < count; index++) {
            const key = sortKeys[index];
            const rank = Math.floor(key / rowCount);
            const row = key - rank * rowCount;
            if (index > 0 && rank !== previousRank) {
              consider(feature, leftWeight, previousRank, features[previousRow * featureCount + feature], features[row * featureCount + feature]);
            }
            const weight = weights[row];
            leftWeight += weight;
            if (classCount) leftSums[target[row]] += weight;
            else leftSums[0] += weight * target[row];
            previousRank = rank;
            previousRow = row;
          }
        }
      }
      if (bestFeature < 0) continue;

      const splitRanks = bestFeature * rowCount;
      let boundary = start;
      for (let index = start; index < end; index++) {
        const row = samples[index];
        if (ranks[splitRanks + row] <= bestRank) {
          samples[index] = samples[boundary];
          samples[boundary++] = row;
          nodeOf[row] = nodeCount;
        } else {
          nodeOf[row] = nodeCount + 1;
        }
      }
      nodeFeature[node] = bestFeature;
      nodeThreshold[node] = bestThreshold;
      nodeLeft[node] = nodeCount;
      nodeRight[node] = nodeCount + 1;
      stack.push(start, boundary, nodeCount, boundary, end, nodeCount + 1);
      nodeCount += 2;
    }

    for (let index = 0; index < predictRows.length; index++) {
      const offset = predictRows[index] * featureCount;
      let node = 0;
      while (nodeFeature[node] >= 0) {
        node = features[offset + nodeFeature[node]] <= nodeThreshold[node] ? nodeLeft[node] : nodeRight[node];
      }
      if (classCount) totals[index * outputs + nodeValue[node]] += 1;
      else totals[index] += nodeValue[node];
    }
    request.onTree?.(tree + 1);
  }

  const predictions = new Float64Array(predictRows.length);
  for (let index = 0; index < predictRows.length; index++) {
    if (!classCount) { predictions[index] = totals[index] / request.trees; continue; }
    let best = 0;
    for (let label = 1; label < classCount; label++) {
      if (totals[index * outputs + label] > totals[index * outputs + best]) best = label;
    }
    predictions[index] = best;
  }
  return predictions;
}

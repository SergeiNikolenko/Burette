export type NeighbourMetric = "euclidean" | "tanimoto";

/**
 * The descriptor space distances are measured in. Euclidean distances use
 * features scaled by the standard deviation of the fitted rows, so a molecular
 * weight does not drown out a ring count; Tanimoto reads every feature as a bit.
 */
export type NeighbourSpace =
  | { metric: "euclidean"; features: Float64Array; featureCount: number; inverseScale: Float64Array }
  | { metric: "tanimoto"; words: Uint32Array; wordCount: number; bitCounts: Int32Array };

export type Neighbours = { rows: Int32Array; distances: Float64Array };

export function neighbourSpace(
  features: Float64Array,
  rowCount: number,
  featureCount: number,
  metric: NeighbourMetric,
  fitRows: Int32Array,
): NeighbourSpace {
  if (metric === "tanimoto") {
    const wordCount = Math.ceil(featureCount / 32);
    const words = new Uint32Array(rowCount * wordCount);
    const bitCounts = new Int32Array(rowCount);
    for (let row = 0; row < rowCount; row++) {
      const offset = row * featureCount;
      for (let feature = 0; feature < featureCount; feature++) {
        if (features[offset + feature] > 0) {
          words[row * wordCount + (feature >>> 5)] |= 1 << (feature & 31);
          bitCounts[row] += 1;
        }
      }
    }
    return { metric, words, wordCount, bitCounts };
  }
  const mean = new Float64Array(featureCount);
  for (const row of fitRows) {
    const offset = row * featureCount;
    for (let feature = 0; feature < featureCount; feature++) mean[feature] += features[offset + feature];
  }
  for (let feature = 0; feature < featureCount; feature++) mean[feature] /= fitRows.length;
  const spread = new Float64Array(featureCount);
  for (const row of fitRows) {
    const offset = row * featureCount;
    for (let feature = 0; feature < featureCount; feature++) {
      const delta = features[offset + feature] - mean[feature];
      spread[feature] += delta * delta;
    }
  }
  // Population standard deviation; a feature that never varies keeps scale 1.
  const inverseScale = new Float64Array(featureCount);
  for (let feature = 0; feature < featureCount; feature++) {
    const deviation = Math.sqrt(spread[feature] / fitRows.length);
    inverseScale[feature] = deviation > 0 ? 1 / deviation : 1;
  }
  return { metric, features, featureCount, inverseScale };
}

function popcount(value: number) {
  let bits = value - ((value >>> 1) & 0x55555555);
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  bits = (bits + (bits >>> 4)) & 0x0f0f0f0f;
  return Math.imul(bits, 0x01010101) >>> 24;
}

/**
 * The `count` candidates closest to `query`, nearest first; the query row is
 * never its own neighbour. Equal distances keep candidate order.
 */
export function nearestRows(space: NeighbourSpace, query: number, candidates: Int32Array, count: number): Neighbours {
  const rows = new Int32Array(count);
  const distances = new Float64Array(count);
  let found = 0;
  for (const candidate of candidates) {
    if (candidate === query) continue;
    let distance = 0;
    if (space.metric === "euclidean") {
      const { features, featureCount, inverseScale } = space;
      const left = query * featureCount;
      const right = candidate * featureCount;
      for (let feature = 0; feature < featureCount; feature++) {
        const delta = (features[left + feature] - features[right + feature]) * inverseScale[feature];
        distance += delta * delta;
      }
    } else {
      const { words, wordCount, bitCounts } = space;
      const left = query * wordCount;
      const right = candidate * wordCount;
      let shared = 0;
      for (let word = 0; word < wordCount; word++) shared += popcount(words[left + word] & words[right + word]);
      const union = bitCounts[query] + bitCounts[candidate] - shared;
      distance = union === 0 ? 1 : 1 - shared / union;
    }
    if (found === count && distance >= distances[count - 1]) continue;
    let slot = found < count ? found++ : count - 1;
    while (slot > 0 && distances[slot - 1] > distance) {
      distances[slot] = distances[slot - 1];
      rows[slot] = rows[slot - 1];
      slot -= 1;
    }
    distances[slot] = distance;
    rows[slot] = candidate;
  }
  const nearest = { rows: rows.slice(0, found), distances: distances.slice(0, found) };
  if (space.metric === "euclidean") nearest.distances.forEach((value, index) => { nearest.distances[index] = Math.sqrt(value); });
  return nearest;
}

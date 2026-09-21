// Pearson correlations between the numeric columns of a collection.
// Observations are pairwise-complete: each pair uses the rows where both
// columns carry a number, so one sparse column cannot erase every other
// correlation the way listwise deletion would.

// Fewer shared rows than this and the coefficient is an artefact of the few
// points that happened to line up.
const MIN_PAIRS = 3;

export function pearson(xs, ys) {
  const count = Math.min(xs.length, ys.length);
  if (count < MIN_PAIRS) return null;
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index < count; index += 1) {
    sumX += xs[index];
    sumY += ys[index];
  }
  const meanX = sumX / count;
  const meanY = sumY / count;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let index = 0; index < count; index += 1) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  // A column that never varies has no direction to correlate with.
  if (varianceX <= 0 || varianceY <= 0) return null;
  const r = covariance / Math.sqrt(varianceX * varianceY);
  // Rounding drift can push a perfect correlation just past the unit range.
  return Math.max(-1, Math.min(1, r));
}

// columns: [{ id, label, values: Array<[rowId, value]> }]
// Returns { labels, ids, matrix, counts } where matrix[i][j] is the coefficient
// or null when the pair has too little overlap to mean anything.
export function correlationMatrix(columns) {
  const prepared = columns.map((column) => ({
    id: column.id,
    label: column.label,
    values: new Map((column.values ?? []).filter(
      (entry) => Array.isArray(entry) && Number.isFinite(Number(entry[1])),
    ).map((entry) => [Number(entry[0]), Number(entry[1])])),
  }));
  const size = prepared.length;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const counts = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let row = 0; row < size; row += 1) {
    matrix[row][row] = prepared[row].values.size >= MIN_PAIRS ? 1 : null;
    counts[row][row] = prepared[row].values.size;
    for (let column = row + 1; column < size; column += 1) {
      const left = prepared[row].values;
      const right = prepared[column].values;
      // Walk the smaller column so the cost follows the sparser one.
      const [small, large] = left.size <= right.size ? [left, right] : [right, left];
      const xs = [];
      const ys = [];
      for (const [rowId, value] of small) {
        const other = large.get(rowId);
        if (other === undefined) continue;
        if (small === left) {
          xs.push(value);
          ys.push(other);
        } else {
          xs.push(other);
          ys.push(value);
        }
      }
      const r = pearson(xs, ys);
      matrix[row][column] = r;
      matrix[column][row] = r;
      counts[row][column] = xs.length;
      counts[column][row] = xs.length;
    }
  }
  return {
    ids: prepared.map((column) => column.id),
    labels: prepared.map((column) => column.label),
    matrix,
    counts,
  };
}

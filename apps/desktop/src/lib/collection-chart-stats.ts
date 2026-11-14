// Aggregations behind the histogram, bar and box charts. Every function takes
// `groupOfRow`: the band a row falls into, or -1 for a row that is filtered out
// or has no value. Selection highlights reuse the same grouping with a mask.

const MIN_BINS = 5;
const MAX_BINS = 50;

function niceStep(rawStep: number, mantissas: readonly number[]) {
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  return (mantissas.find(mantissa => mantissa >= normalized - 1e-9) ?? 10) * magnitude;
}

export type AxisTicks = { min: number; max: number; step: number; ticks: number[] };

function ticksAt(min: number, max: number, step: number): AxisTicks {
  const ticks: number[] = [];
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  // Adding zero turns the -0 that a negative-rounded index produces into 0.
  for (let index = first; index <= last && ticks.length < 64; index += 1) ticks.push(index * step + 0);
  return { min, max, step, ticks };
}

/** Round tick positions inside [min, max]; the range itself is left alone. */
export function axisTicks(min: number, max: number, target = 5): AxisTicks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  if (max <= min) return { min, max, step: 1, ticks: [min] };
  return ticksAt(min, max, niceStep((max - min) / Math.max(1, target), [1, 2, 5, 10]));
}

/** The same ticks, with the range widened to the ticks around it. */
export function niceAxis(min: number, max: number, target = 5): AxisTicks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return axisTicks(min, max, target);
  if (max <= min) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    return niceAxis(min - pad, max + pad, target);
  }
  const step = niceStep((max - min) / Math.max(1, target), [1, 2, 5, 10]);
  return ticksAt(Math.floor(min / step + 1e-9) * step + 0, Math.ceil(max / step - 1e-9) * step + 0, step);
}

export function formatAxisValue(value: number, step: number) {
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || magnitude < 1e-4) return value.toExponential(2).replace(/\.?0+e/u, "e").replace("e+", "e");
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
  return value.toFixed(decimals);
}

export type Histogram = {
  start: number;
  step: number;
  counts: Uint32Array;
  /** Bin of every row, -1 for rows left out. */
  binOfRow: Int32Array;
};

// Sturges' bin count, then the step is rounded up to 1, 2, 2.5 or 5 × 10ⁿ so the
// edges are numbers a person would pick. Bins are [edge, next edge) and the last
// one also holds its upper edge. Whole-number columns get one bin per integer
// (or per round run of integers) so a count of rings is not split at 2.5.
export function histogram(values: Float64Array, include: Uint8Array): Histogram | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let count = 0;
  let integers = true;
  for (let row = 0; row < values.length; row += 1) {
    const value = values[row];
    if (!include[row] || value !== value) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    if (integers && !Number.isInteger(value)) integers = false;
    count += 1;
  }
  if (count === 0) return null;
  const target = Math.min(MAX_BINS, Math.max(MIN_BINS, Math.ceil(Math.log2(count)) + 1));
  let step = niceStep((max - min) / target, [1, 2, 2.5, 5, 10]);
  let start: number;
  let bins: number;
  if (integers) {
    step = Math.max(1, Math.ceil(step));
    start = min - 0.5;
    bins = Math.max(1, Math.ceil((max + 0.5 - start) / step));
  } else {
    start = Math.floor(min / step + 1e-9) * step;
    bins = Math.max(1, Math.ceil((max - start) / step - 1e-9));
  }
  const counts = new Uint32Array(bins);
  const binOfRow = new Int32Array(values.length).fill(-1);
  for (let row = 0; row < values.length; row += 1) {
    const value = values[row];
    if (!include[row] || value !== value) continue;
    let bin = Math.floor((value - start) / step);
    // Division can land one bin off a value that sits exactly on an edge.
    if (value < start + bin * step) bin -= 1;
    else if (value >= start + (bin + 1) * step) bin += 1;
    bin = Math.min(bins - 1, Math.max(0, bin));
    binOfRow[row] = bin;
    counts[bin] += 1;
  }
  return { start, step, counts, binOfRow };
}

/** Rows per group, optionally only the rows a mask marks. */
export function countByGroup(groupOfRow: Int32Array, groupCount: number, mask: Uint8Array | null = null) {
  const counts = new Uint32Array(groupCount);
  for (let row = 0; row < groupOfRow.length; row += 1) {
    const group = groupOfRow[row];
    if (group >= 0 && (mask === null || mask[row])) counts[group] += 1;
  }
  return counts;
}

/** Category of every drawn row; rows that are filtered out lose their group. */
export function groupsOfIncluded(codes: Int32Array, include: Uint8Array) {
  const groupOfRow = new Int32Array(codes.length);
  for (let row = 0; row < codes.length; row += 1) groupOfRow[row] = include[row] ? codes[row] : -1;
  return groupOfRow;
}

/** Mean of `values` per group over rows that have a number; NaN for an empty group. */
export function meanByGroup(groupOfRow: Int32Array, groupCount: number, values: Float64Array) {
  const sums = new Float64Array(groupCount);
  const counts = new Uint32Array(groupCount);
  for (let row = 0; row < groupOfRow.length; row += 1) {
    const group = groupOfRow[row];
    const value = values[row];
    if (group < 0 || value !== value) continue;
    sums[group] += value;
    counts[group] += 1;
  }
  const means = new Float64Array(groupCount);
  for (let group = 0; group < groupCount; group += 1) {
    means[group] = counts[group] ? sums[group] / counts[group] : Number.NaN;
  }
  return means;
}

export type BoxStats = {
  count: number;
  q1: number;
  median: number;
  q3: number;
  /** Furthest values still within 1.5 × IQR of the box (Tukey). */
  whiskerLow: number;
  whiskerHigh: number;
  /** Rows beyond the whiskers, drawn and picked one by one. */
  outlierRows: Int32Array;
};

function quantile(sorted: Float64Array, fraction: number) {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}

// Quartiles interpolate linearly between order statistics (Hyndman–Fan type 7,
// the default of R, NumPy and matplotlib), so the numbers match those tools.
export function boxStatsByGroup(groupOfRow: Int32Array, groupCount: number, values: Float64Array) {
  const rowsByGroup: number[][] = Array.from({ length: groupCount }, () => []);
  for (let row = 0; row < groupOfRow.length; row += 1) {
    const group = groupOfRow[row];
    if (group >= 0 && values[row] === values[row]) rowsByGroup[group].push(row);
  }
  return rowsByGroup.map((rows): BoxStats | null => {
    if (rows.length === 0) return null;
    const sorted = Float64Array.from(rows, row => values[row]).sort();
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const fence = 1.5 * (q3 - q1);
    let whiskerLow = q1;
    let whiskerHigh = q3;
    for (const value of sorted) {
      if (value >= q1 - fence) { whiskerLow = Math.min(q1, value); break; }
    }
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      if (sorted[index] <= q3 + fence) { whiskerHigh = Math.max(q3, sorted[index]); break; }
    }
    const outlierRows = Int32Array.from(rows.filter(row => values[row] < whiskerLow || values[row] > whiskerHigh));
    return { count: rows.length, q1, median: quantile(sorted, 0.5), q3, whiskerLow, whiskerHigh, outlierRows };
  });
}

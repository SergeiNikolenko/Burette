// Reads a row value against its column's distribution so a single value can be
// placed in context: where it sits in the spread, and whether it is unusual.
// The distribution comes from the equal-width histogram the grid already
// computes for the filter panel, so nothing extra crosses the bridge.

// Below this many rows a "spread" is noise, not a distribution.
const MIN_ROWS_FOR_STATS = 8;
// A numeric column whose values land in at most this many histogram buckets is
// a flag or a small category set (activity 0/1), not a continuous measurement.
const MAX_CATEGORICAL_BUCKETS = 2;
const OUTLIER_FENCE = 1.5;

function binTotal(bins) {
  let total = 0;
  for (const bin of bins) total += Number(bin) || 0;
  return total;
}

// Linear interpolation inside the bucket the quantile falls into. Binned
// quartiles are approximate by construction; with 32 buckets that is precise
// enough to fence outliers, and it never needs the raw column.
function quantile(bins, total, min, max, q) {
  const target = q * total;
  const width = (max - min) / bins.length;
  let cumulative = 0;
  for (let index = 0; index < bins.length; index += 1) {
    const count = Number(bins[index]) || 0;
    if (count > 0 && cumulative + count >= target) {
      return min + width * (index + (target - cumulative) / count);
    }
    cumulative += count;
  }
  return max;
}

function shareBelow(bins, total, min, max, value) {
  if (value <= min) return 0;
  if (value >= max) return 1;
  const width = (max - min) / bins.length;
  const rawIndex = (value - min) / width;
  const index = Math.min(bins.length - 1, Math.max(0, Math.floor(rawIndex)));
  let cumulative = 0;
  for (let position = 0; position < index; position += 1) cumulative += Number(bins[position]) || 0;
  cumulative += (Number(bins[index]) || 0) * Math.min(1, Math.max(0, rawIndex - index));
  return Math.min(1, Math.max(0, cumulative / total));
}

export function columnStats(column) {
  const bins = Array.isArray(column?.bins) ? column.bins : null;
  const min = Number(column?.min);
  const max = Number(column?.max);
  if (!bins || bins.length === 0) return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return null;
  const total = binTotal(bins);
  if (total < MIN_ROWS_FOR_STATS) return null;
  const filledBuckets = bins.reduce((count, bin) => count + ((Number(bin) || 0) > 0 ? 1 : 0), 0);
  if (filledBuckets <= MAX_CATEGORICAL_BUCKETS) {
    return { min, max, total, categorical: true };
  }
  // Interpolated quartiles are strictly ordered once more than two buckets
  // carry values, so the fences always straddle a real spread.
  const q1 = quantile(bins, total, min, max, 0.25);
  const q3 = quantile(bins, total, min, max, 0.75);
  const iqr = q3 - q1;
  return {
    min,
    max,
    total,
    categorical: false,
    q1,
    q3,
    lowerFence: q1 - OUTLIER_FENCE * iqr,
    upperFence: q3 + OUTLIER_FENCE * iqr,
  };
}

export function ordinal(value) {
  const rounded = Math.round(value);
  const lastTwo = rounded % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${rounded}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[rounded % 10] ?? "th";
  return `${rounded}${suffix}`;
}

// Returns how a tile should present the value:
//   tone      - "plain" | "flag-on" | "flag-off" | "outlier-high" | "outlier-low"
//   position  - 0..1 place within the column range, or null when meaningless
//   detail    - one line for the tooltip, or null
export function describePropValue(rawValue, column) {
  // Number("") is 0, so a blank cell would otherwise read as a real zero and
  // pick up a percentile it never earned.
  const text = String(rawValue ?? "").trim();
  const numeric = text === "" ? Number.NaN : Number(text);
  const stats = Number.isFinite(numeric) ? columnStats(column) : null;
  if (!stats) return { tone: "plain", position: null, detail: null };
  const rows = `${stats.total.toLocaleString()} rows`;
  if (stats.categorical) {
    const on = numeric >= (stats.min + stats.max) / 2;
    return {
      tone: on ? "flag-on" : "flag-off",
      position: null,
      detail: `${on ? "High" : "Low"} of ${stats.min.toLocaleString()}/${stats.max.toLocaleString()} · ${rows}`,
    };
  }
  const position = Math.min(1, Math.max(0, (numeric - stats.min) / (stats.max - stats.min)));
  const percentile = shareBelow([...column.bins], stats.total, stats.min, stats.max, numeric) * 100;
  if (numeric > stats.upperFence) {
    return { tone: "outlier-high", position, detail: `Unusually high · above ${stats.q3.toPrecision(4)} + 1.5 × IQR · ${rows}` };
  }
  if (numeric < stats.lowerFence) {
    return { tone: "outlier-low", position, detail: `Unusually low · below ${stats.q1.toPrecision(4)} − 1.5 × IQR · ${rows}` };
  }
  return { tone: "plain", position, detail: `${ordinal(percentile)} percentile · ${rows}` };
}

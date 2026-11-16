import type { CategorySeries, NumericSeries } from "./collection-chart-data";
import {
  boxStatsByGroup,
  countByGroup,
  groupsOfIncluded,
  histogram,
  meanByGroup,
  niceAxis,
  type AxisTicks,
  type BoxStats,
} from "./collection-chart-stats";
import type { PlotRect } from "./collection-chart-scatter";

// Histogram, bar and box charts share one shape: bands laid side by side along
// X, each holding the rows that fall into it. Picking a band picks its rows, and
// the selected share of a band is what the chart highlights.

export type BandChart = {
  kind: "histogram" | "bar" | "box";
  bandCount: number;
  /** Band of every row, -1 for rows the chart does not draw. */
  groupOfRow: Int32Array;
  rowCounts: Uint32Array;
  /** Bar heights; null for a box chart. */
  heights: Float64Array | null;
  /** One label per band, or null when X is a number axis. */
  labels: string[] | null;
  /** Lower edge of the first bin and the bin width, for a histogram. */
  bins: { start: number; step: number } | null;
  boxes: Array<BoxStats | null> | null;
  /** The numbers behind the boxes, to place outliers. */
  rowValues: Float64Array | null;
  axis: AxisTicks;
};

export function histogramChart(series: NumericSeries, include: Uint8Array): BandChart | null {
  const result = histogram(series.values, include);
  if (!result) return null;
  let max = 0;
  for (const count of result.counts) max = Math.max(max, count);
  return {
    kind: "histogram",
    bandCount: result.counts.length,
    groupOfRow: result.binOfRow,
    rowCounts: result.counts,
    heights: Float64Array.from(result.counts),
    labels: null,
    bins: { start: result.start, step: result.step },
    boxes: null,
    rowValues: null,
    axis: niceAxis(0, max),
  };
}

/** Rows per category, or the mean of `value` per category when one is given. */
export function barChart(category: CategorySeries, include: Uint8Array, value: NumericSeries | null): BandChart | null {
  const bandCount = category.labels.length;
  const groupOfRow = groupsOfIncluded(category.codes, include);
  if (value) {
    for (let row = 0; row < groupOfRow.length; row += 1) {
      if (value.values[row] !== value.values[row]) groupOfRow[row] = -1;
    }
  }
  const rowCounts = countByGroup(groupOfRow, bandCount);
  if (!rowCounts.some(count => count > 0)) return null;
  const heights = value ? meanByGroup(groupOfRow, bandCount, value.values) : Float64Array.from(rowCounts);
  let min = 0;
  let max = 0;
  for (const height of heights) {
    if (height !== height) continue;
    min = Math.min(min, height);
    max = Math.max(max, height);
  }
  return {
    kind: "bar",
    bandCount,
    groupOfRow,
    rowCounts,
    heights,
    labels: category.labels,
    bins: null,
    boxes: null,
    rowValues: null,
    axis: niceAxis(min, max),
  };
}

/** One box per category, or a single box over every row when there is none. */
export function boxChart(category: CategorySeries | null, include: Uint8Array, value: NumericSeries, valueLabel: string): BandChart | null {
  const bandCount = category ? category.labels.length : 1;
  const groupOfRow = category
    ? groupsOfIncluded(category.codes, include)
    : Int32Array.from(include, included => included ? 0 : -1);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let row = 0; row < groupOfRow.length; row += 1) {
    const number = value.values[row];
    if (number !== number) groupOfRow[row] = -1;
    if (groupOfRow[row] < 0) continue;
    min = Math.min(min, number);
    max = Math.max(max, number);
  }
  if (min > max) return null;
  return {
    kind: "box",
    bandCount,
    groupOfRow,
    rowCounts: countByGroup(groupOfRow, bandCount),
    heights: null,
    labels: category ? category.labels : [valueLabel],
    bins: null,
    boxes: boxStatsByGroup(groupOfRow, bandCount, value.values),
    rowValues: value.values,
    axis: niceAxis(min, max),
  };
}

export function bandAt(x: number, plot: PlotRect, bandCount: number) {
  if (!(x >= plot.left && x < plot.left + plot.width)) return -1;
  return Math.min(bandCount - 1, Math.floor(((x - plot.left) / plot.width) * bandCount));
}

export function bandCenter(band: number, plot: PlotRect, bandCount: number) {
  return plot.left + ((band + 0.5) / bandCount) * plot.width;
}

export function valueToY(value: number, axis: AxisTicks, plot: PlotRect) {
  return plot.top + plot.height * (1 - (value - axis.min) / (axis.max - axis.min));
}

export function rowsOfBands(chart: BandChart, first: number, last: number) {
  const rows: number[] = [];
  for (let row = 0; row < chart.groupOfRow.length; row += 1) {
    const band = chart.groupOfRow[row];
    if (band >= first && band <= last) rows.push(row);
  }
  return rows;
}

/** The outlier under the pointer in a box chart, or -1. */
export function outlierAt(chart: BandChart, plot: PlotRect, x: number, y: number, maxDistance: number) {
  const band = bandAt(x, plot, chart.bandCount);
  const box = band < 0 ? null : chart.boxes?.[band];
  if (!box || !chart.rowValues || Math.abs(x - bandCenter(band, plot, chart.bandCount)) > maxDistance) return -1;
  let best = -1;
  let bestDistance = maxDistance;
  for (const row of box.outlierRows) {
    const distance = Math.abs(valueToY(chart.rowValues[row], chart.axis, plot) - y);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = row;
    }
  }
  return best;
}

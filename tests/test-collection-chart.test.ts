import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { barChart, bandAt, boxChart, histogramChart, outlierAt, rowsOfBands, valueToY } from "../apps/desktop/src/lib/collection-chart-bands";
import { resolveChartConfig, type ChartChoices } from "../apps/desktop/src/lib/collection-chart-config";
import {
  COLLECTION_CHART_ROW_LIMIT,
  OTHER_CATEGORY_LABEL,
  categorySeries,
  chartSeriesKey,
  chartTableFromBridge,
  numericSeries,
  rowMask,
  sourceRecordIdsOfRows,
  type CategorySeries,
  type ChartColumn,
  type NumericSeries,
} from "../apps/desktop/src/lib/collection-chart-data";
import { axisTicks, countByGroup, formatAxisValue, histogram, niceAxis } from "../apps/desktop/src/lib/collection-chart-stats";

// The fixture's SD properties, read the way the grid hands them over: one value
// per record, numbers as numbers and categories as text.
const records = readFileSync("tests/fixtures/collection-chart/moses-properties.sdf", "utf8")
  .split("$$$$\n").filter(block => block.trim())
  .map(block => Object.fromEntries([...block.matchAll(/> <([^>]+)>\n([^\n]*)/gu)].map(match => [match[1], match[2]])));
const reference = JSON.parse(readFileSync("tests/fixtures/collection-chart/reference.json", "utf8"));
const rowCount = records.length;
const everyRow = new Uint8Array(rowCount).fill(1);
const numbers = (name: string) => numericSeries(records.map(record => Number(record[name])), rowCount);
const categories = (name: string) => categorySeries(records.map(record => record[name]), rowCount);

test("histograms count the fixture's rows exactly as NumPy does on the same edges", () => {
  expect(rowCount).toBe(reference.records);
  const expectedBins = { MolWt: [240, 20], SLogP: [-1, 1], TPSA: [0, 20], Rings: [0.5, 1] } as const;
  for (const [name, [start, step]] of Object.entries(expectedBins)) {
    const chart = histogramChart(numbers(name), everyRow)!;
    expect(chart.bins).toEqual({ start, step });
    expect([...chart.rowCounts]).toEqual(reference.histogram[name]);
    expect(chart.rowCounts.reduce((sum, count) => sum + count, 0)).toBe(rowCount);
  }
  // Rings is a whole-number column: one bin per ring count, not a split at 2.5.
  expect(histogramChart(numbers("Rings"), everyRow)!.bandCount).toBe(4);
});

test("histogram bins keep edge values on the upper side and the maximum in the last bin", () => {
  const values = Float64Array.from([0.1, 0.2, 0.30000000000000004, 0.3, 0.7, 1.5, Number.NaN]);
  const result = histogram(values, new Uint8Array(values.length).fill(1))!;
  const edge = (bin: number) => result.start + bin * result.step;
  for (let row = 0; row < values.length - 1; row += 1) {
    const bin = result.binOfRow[row];
    expect(values[row] >= edge(bin)).toBe(true);
    expect(values[row] < edge(bin + 1) || bin === result.counts.length - 1).toBe(true);
  }
  expect(result.binOfRow.at(-1)).toBe(-1);
  expect(result.binOfRow[5]).toBe(result.counts.length - 1);
  // A filtered-out row is not counted and has no bin.
  const filtered = histogram(values, Uint8Array.from([1, 0, 1, 1, 1, 1, 1]))!;
  expect(filtered.binOfRow[1]).toBe(-1);
  expect(filtered.counts.reduce((sum, count) => sum + count, 0)).toBe(5);
  expect(histogram(values, new Uint8Array(values.length))).toBeNull();
});

test("box statistics match matplotlib's boxplot_stats on the fixture", () => {
  for (const [value, group] of [["SLogP", "Halogen"], ["MolWt", "Rings"]] as const) {
    const series = categories(group);
    const valueSeries = numbers(value);
    const chart = boxChart(series, everyRow, valueSeries, value)!;
    const expected = reference.box[`${value} by ${group}`];
    expect([...series.labels].sort()).toEqual(Object.keys(expected).sort());
    series.labels.forEach((label, band) => {
      const box = chart.boxes![band]!;
      const want = expected[label];
      expect(box.count).toBe(want.count);
      for (const key of ["q1", "median", "q3", "whiskerLow", "whiskerHigh"] as const) {
        expect(box[key]).toBeCloseTo(want[key], 10);
      }
      expect([...box.outlierRows].map(row => valueSeries.values[row]).sort((a, b) => a - b)).toEqual(want.outliers);
    });
  }
  // Without a group column there is one box over every row.
  const single = boxChart(null, everyRow, numbers("SLogP"), "SLogP")!;
  expect(single.labels).toEqual(["SLogP"]);
  expect(single.boxes![0]!.count).toBe(rowCount);
});

test("bar charts count rows per category and average a value column", () => {
  const halogen = categories("Halogen");
  // Text categories read biggest first; ties fall back to the label.
  expect(halogen.labels).toEqual(["none", "F", "Cl", "Br+F", "Cl+F"]);
  const counts = barChart(halogen, everyRow, null)!;
  expect([...counts.rowCounts]).toEqual([33, 7, 5, 1, 1]);
  expect(counts.axis).toMatchObject({ min: 0, max: 40, step: 10 });
  const means = barChart(halogen, everyRow, numbers("MolWt"))!;
  halogen.labels.forEach((label, band) => {
    expect(means.heights![band]).toBeCloseTo(reference["mean MolWt by Halogen"][label], 9);
  });
  // Numbers used as categories keep their numeric order.
  expect(categories("Rings").labels).toEqual(["1", "2", "3", "4"]);
  expect([...barChart(categories("Rings"), everyRow, null)!.rowCounts]).toEqual([3, 21, 17, 6]);
});

test("a grid filter removes rows from every aggregate, and a selection is counted per band", () => {
  const halogen = categories("Halogen");
  const fluorinated = Uint8Array.from(records, record => record.Halogen.includes("F") ? 1 : 0);
  const chart = barChart(halogen, fluorinated, null)!;
  expect([...chart.rowCounts]).toEqual([0, 7, 0, 1, 1]);
  const selected = Uint8Array.from(records, record => Number(record.MolWt) > 300 ? 1 : 0);
  const all = barChart(halogen, everyRow, null)!;
  const picked = countByGroup(all.groupOfRow, all.bandCount, selected);
  expect(picked.reduce((sum, count) => sum + count, 0)).toBe(records.filter(record => Number(record.MolWt) > 300).length);
  // Picking the second and third bars picks exactly their rows.
  const rows = rowsOfBands(all, 1, 2);
  expect(rows.length).toBe(12);
  expect(rows.every(row => ["F", "Cl"].includes(records[row].Halogen))).toBe(true);
  expect(barChart(halogen, new Uint8Array(rowCount), null)).toBeNull();
});

test("bands and outliers are picked by pointer position", () => {
  const plot = { left: 40, top: 10, width: 400, height: 200 };
  expect(bandAt(39, plot, 4)).toBe(-1);
  expect(bandAt(40, plot, 4)).toBe(0);
  expect(bandAt(439.9, plot, 4)).toBe(3);
  expect(bandAt(440, plot, 4)).toBe(-1);
  const valueSeries = numbers("MolWt");
  const chart = boxChart(categories("Rings"), everyRow, valueSeries, "MolWt")!;
  const outlier = chart.boxes![3]!.outlierRows[0];
  expect(valueSeries.values[outlier]).toBe(345.428);
  const y = valueToY(345.428, chart.axis, plot);
  expect(outlierAt(chart, plot, 390, y + 2, 6)).toBe(outlier);
  expect(outlierAt(chart, plot, 390, y + 20, 6)).toBe(-1);
  expect(outlierAt(chart, plot, 90, y, 6)).toBe(-1);
});

test("axes use round ticks and widen to them only when asked", () => {
  expect(axisTicks(0.3, 9.7).ticks).toEqual([2, 4, 6, 8]);
  expect(niceAxis(0.3, 9.7)).toEqual({ min: 0, max: 10, step: 2, ticks: [0, 2, 4, 6, 8, 10] });
  expect(niceAxis(-0.0092, 4.2069)).toEqual({ min: -1, max: 5, step: 1, ticks: [-1, 0, 1, 2, 3, 4, 5] });
  expect(Object.is(niceAxis(0, 33).ticks[0], 0)).toBe(true);
  expect(niceAxis(5, 5).min).toBeLessThan(5);
  expect(formatAxisValue(0.25, 0.05)).toBe("0.25");
  expect(formatAxisValue(300, 20)).toBe("300");
  expect(formatAxisValue(2_500_000, 500_000)).toBe("2.5e6");
});

test("categories fold the long tail into Other and blanks stay out", () => {
  const raw = [...Array.from({ length: 60 }, (_, index) => `c${index % 30}`), "", "c0", "c0", 7];
  const series = categorySeries(raw, raw.length, 5);
  expect(series.labels).toEqual(["c0", "c1", "c2", "c3", OTHER_CATEGORY_LABEL]);
  expect(series.codes[60]).toBe(-1);
  expect(series.codes[63]).toBe(-1);
  expect(series.codes[4]).toBe(4);
  expect(countByGroup(series.codes, 5)[0]).toBe(4);
});

test("the bridge answer is validated once and bounded", () => {
  const requests = [{ id: "prop:MolWt", valueType: "number" }, { id: "prop:Halogen", valueType: "text" }] as const;
  const body = {
    sourceRecordIds: [4, 9, 2],
    total: 3,
    columns: [
      { id: "prop:MolWt", valueType: "number", values: [300.5, null, "310"] },
      { id: "prop:Halogen", valueType: "text", values: ["F", "", "Cl"] },
    ],
  };
  const table = chartTableFromBridge(body, requests)!;
  const molWt = table.series.get(chartSeriesKey(requests[0])) as NumericSeries;
  // A string where a number was asked for is not a number.
  expect([...molWt.values]).toEqual([300.5, Number.NaN, Number.NaN]);
  expect(molWt).toMatchObject({ min: 300.5, max: 300.5, count: 1 });
  expect((table.series.get(chartSeriesKey(requests[1])) as CategorySeries).labels).toEqual(["Cl", "F"]);
  expect([...rowMask(table, [9, 2, 77])]).toEqual([0, 1, 1]);
  expect([...rowMask(table, null)]).toEqual([1, 1, 1]);
  expect(sourceRecordIdsOfRows(table, [2, 0])).toEqual([2, 4]);
  expect(chartTableFromBridge({ ...body, sourceRecordIds: [4, -1, 2] }, requests)).toBeNull();
  expect(chartTableFromBridge({ ...body, sourceRecordIds: [4, 1.5, 2] }, requests)).toBeNull();
  expect(chartTableFromBridge({ ...body, columns: [body.columns[0]] }, requests)).toBeNull();
  expect(chartTableFromBridge({ ...body, columns: [{ ...body.columns[0], values: [1] }, body.columns[1]] }, requests)).toBeNull();
  const oversized = COLLECTION_CHART_ROW_LIMIT + 5;
  const large = chartTableFromBridge({
    sourceRecordIds: Array.from({ length: oversized }, (_, index) => index),
    total: 250_000,
    columns: [{ id: "prop:MolWt", valueType: "number", values: new Array(oversized).fill(1) }],
  }, [requests[0]])!;
  expect(large.sourceRecordIds.length).toBe(COLLECTION_CHART_ROW_LIMIT);
  expect(large.total).toBe(250_000);
});

test("a chart picks sensible columns and keeps the user's picks per chart type", () => {
  const columns: ChartColumn[] = [
    { id: "prop:MolWt", label: "MolWt", type: "number" },
    { id: "prop:SLogP", label: "SLogP", type: "number" },
    { id: "prop:Halogen", label: "Halogen", type: "text" },
  ];
  const ids = (choices: ChartChoices) => {
    const config = resolveChartConfig(columns, choices)!;
    return { type: config.type, x: config.x.column?.id, y: config.y?.column?.id, requests: config.requests };
  };
  expect(ids({})).toEqual({
    type: "scatter", x: "prop:MolWt", y: "prop:SLogP",
    requests: [{ id: "prop:MolWt", valueType: "number" }, { id: "prop:SLogP", valueType: "number" }],
  });
  expect(ids({ type: "histogram" })).toMatchObject({ x: "prop:MolWt", requests: [{ id: "prop:MolWt", valueType: "number" }] });
  // A bar chart reads its category as text and counts rows unless a value is picked.
  expect(ids({ type: "bar" })).toEqual({ type: "bar", x: "prop:Halogen", y: undefined, requests: [{ id: "prop:Halogen", valueType: "text" }] });
  expect(ids({ type: "bar", x: { bar: "prop:MolWt" }, y: { bar: "prop:SLogP" } }).requests)
    .toEqual([{ id: "prop:MolWt", valueType: "text" }, { id: "prop:SLogP", valueType: "number" }]);
  expect(ids({ type: "box" })).toMatchObject({ x: "prop:Halogen", y: "prop:MolWt" });
  expect(ids({ type: "box", x: { box: "" } })).toMatchObject({ x: undefined, y: "prop:MolWt" });
  // A pick made for one chart type does not leak into another, and a column
  // that left the collection falls back to the default.
  expect(ids({ type: "scatter", x: { histogram: "prop:SLogP", scatter: "prop:Gone" } }).x).toBe("prop:MolWt");
  const coloured = resolveChartConfig(columns, { color: "prop:Halogen", size: "prop:SLogP" })!;
  expect(coloured.requests).toEqual([
    { id: "prop:MolWt", valueType: "number" },
    { id: "prop:SLogP", valueType: "number" },
    { id: "prop:Halogen", valueType: "text" },
  ]);
  // Without a number column only a bar chart is on offer.
  const textOnly = resolveChartConfig([columns[2]], { type: "scatter" })!;
  expect(textOnly.types).toEqual(["bar"]);
  expect(textOnly.type).toBe("bar");
  expect(resolveChartConfig([], {})).toBeNull();
});

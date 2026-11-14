// Column data for the collection Chart tab. Rows are kept as parallel typed
// arrays so a 100k-row collection costs a few megabytes and a frame only walks
// numbers; `sourceRecordId` is the grid's row id on both sides of the bridge.

export const COLLECTION_CHART_ROW_LIMIT = 100_000;
// Bars, boxes and legend entries a chart can hold before the rest fold into Other.
export const COLLECTION_CHART_CATEGORY_LIMIT = 24;
export const OTHER_CATEGORY_LABEL = "Other";

export type ChartColumn = {
  id: string;
  label: string;
  type: "number" | "text";
};

export type ChartColumnRequest = { id: string; valueType: "number" | "text" };

export type NumericSeries = {
  kind: "number";
  /** NaN where the row has no number. */
  values: Float64Array;
  min: number;
  max: number;
  count: number;
};

export type CategorySeries = {
  kind: "category";
  /** Index into `labels`, or -1 where the row is blank. */
  codes: Int32Array;
  labels: string[];
};

export type ChartSeries = NumericSeries | CategorySeries;

export type ChartTable = {
  sourceRecordIds: Int32Array;
  rowBySourceRecordId: Map<number, number>;
  series: Map<string, ChartSeries>;
  /** Rows in the collection; larger than the table when the bridge limit cut it. */
  total: number;
};

export function chartSeriesKey(request: ChartColumnRequest) {
  return `${request.valueType}:${request.id}`;
}

export function numericSeries(raw: readonly unknown[], rowCount: number): NumericSeries {
  const values = new Float64Array(rowCount).fill(Number.NaN);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (let row = 0; row < rowCount; row += 1) {
    const value = raw[row];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    values[row] = value;
    if (value < min) min = value;
    if (value > max) max = value;
    count += 1;
  }
  return { kind: "number", values, min, max, count };
}

// Numbers used as categories (a cluster id, a ring count) read in numeric
// order; names read by how many rows carry them, the biggest first.
export function categorySeries(
  raw: readonly unknown[],
  rowCount: number,
  limit = COLLECTION_CHART_CATEGORY_LIMIT,
): CategorySeries {
  const counts = new Map<string, number>();
  const texts = new Array<string>(rowCount);
  for (let row = 0; row < rowCount; row += 1) {
    const text = typeof raw[row] === "string" ? (raw[row] as string).trim() : "";
    texts[row] = text;
    if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  let labels = [...counts.keys()];
  const numeric = labels.length > 0 && labels.every(label => Number.isFinite(Number(label)));
  const byCount = (left: string, right: string) =>
    counts.get(right)! - counts.get(left)! || left.localeCompare(right, undefined, { numeric: true });
  let folded = false;
  if (labels.length > limit) {
    labels = labels.sort(byCount).slice(0, limit - 1);
    folded = true;
  }
  labels.sort(numeric ? (left, right) => Number(left) - Number(right) : byCount);
  const codeByLabel = new Map(labels.map((label, code) => [label, code]));
  if (folded) labels.push(OTHER_CATEGORY_LABEL);
  const otherCode = folded ? labels.length - 1 : -1;
  const codes = new Int32Array(rowCount);
  for (let row = 0; row < rowCount; row += 1) {
    const text = texts[row];
    codes[row] = text ? codeByLabel.get(text) ?? otherCode : -1;
  }
  return { kind: "category", codes, labels };
}

// The grid's answer is untrusted here: ids are checked once, value arrays must
// be as long as the id list, and everything past the bridge limit is dropped.
export function chartTableFromBridge(
  body: Record<string, unknown>,
  requests: readonly ChartColumnRequest[],
): ChartTable | null {
  if (!Array.isArray(body.sourceRecordIds) || !Array.isArray(body.columns)) return null;
  const rowCount = Math.min(body.sourceRecordIds.length, COLLECTION_CHART_ROW_LIMIT);
  const sourceRecordIds = new Int32Array(rowCount);
  const rowBySourceRecordId = new Map<number, number>();
  for (let row = 0; row < rowCount; row += 1) {
    const id = body.sourceRecordIds[row];
    if (!Number.isSafeInteger(id) || id < 0 || id > 0x7fffffff) return null;
    sourceRecordIds[row] = id;
    rowBySourceRecordId.set(id, row);
  }
  const series = new Map<string, ChartSeries>();
  for (const request of requests) {
    const column = body.columns.find((candidate): candidate is { values: unknown[] } =>
      Boolean(candidate) && typeof candidate === "object"
      && (candidate as { id?: unknown }).id === request.id
      && (candidate as { valueType?: unknown }).valueType === request.valueType
      && Array.isArray((candidate as { values?: unknown }).values));
    if (!column || column.values.length < rowCount) return null;
    series.set(chartSeriesKey(request), request.valueType === "number"
      ? numericSeries(column.values, rowCount)
      : categorySeries(column.values, rowCount));
  }
  const total = Number(body.total);
  return {
    sourceRecordIds,
    rowBySourceRecordId,
    series,
    total: Number.isSafeInteger(total) && total > rowCount ? total : rowCount,
  };
}

/** One byte per row: 1 where the row's id is in `ids`. `null` means every row. */
export function rowMask(table: ChartTable, ids: Iterable<number> | null): Uint8Array {
  const mask = new Uint8Array(table.sourceRecordIds.length);
  if (ids === null) return mask.fill(1);
  for (const id of ids) {
    const row = table.rowBySourceRecordId.get(id);
    if (row !== undefined) mask[row] = 1;
  }
  return mask;
}

export function sourceRecordIdsOfRows(table: ChartTable, rows: ArrayLike<number>): number[] {
  const ids = new Array<number>(rows.length);
  for (let index = 0; index < rows.length; index += 1) ids[index] = table.sourceRecordIds[rows[index]];
  return ids;
}

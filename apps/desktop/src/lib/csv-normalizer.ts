export interface CsvTable {
  columns: string[];
  rows: string[][];
}

export interface CsvNormalizerOptions {
  /** Treat the first record as a header row. Defaults to true. */
  hasHeader?: boolean;
}

export type CsvTableEvent =
  | { type: "columns"; columns: string[] }
  | { type: "row"; row: string[] };

export interface CsvNormalizer {
  accept(record: string[]): CsvTableEvent[];
  getColumns(): string[];
}

export function createCsvNormalizer(
  options?: CsvNormalizerOptions,
): CsvNormalizer {
  var hasHeader = !options || options.hasHeader !== false;
  var columns: string[] | null = null;
  var width = 0;
  var sawFirstRecord = false;

  function makeColumnName(index: number): string {
    return "Column " + (index + 1);
  }

  function copyAndPad(row: string[], nextWidth: number): string[] {
    var out = row.slice();
    while (out.length < nextWidth) out.push("");
    return out;
  }

  function growColumns(nextWidth: number): CsvTableEvent[] {
    if (!columns || nextWidth <= width) return [];
    var next = columns.slice();
    for (var i = width; i < nextWidth; i++) {
      next.push(hasHeader ? "" : makeColumnName(i));
    }
    columns = next;
    width = nextWidth;
    return [{ type: "columns", columns: next.slice() }];
  }

  function accept(record: string[]): CsvTableEvent[] {
    if (!sawFirstRecord) {
      sawFirstRecord = true;
      width = record.length;
      if (hasHeader) {
        columns = record.slice();
        return [{ type: "columns", columns: columns.slice() }];
      }
      columns = [];
      for (var i = 0; i < width; i++) columns.push(makeColumnName(i));
      return [
        { type: "columns", columns: columns.slice() },
        { type: "row", row: copyAndPad(record, width) },
      ];
    }

    return growColumns(record.length).concat({
      type: "row",
      row: copyAndPad(record, width),
    });
  }

  function getColumns(): string[] {
    return columns ? columns.slice() : [];
  }

  return { accept: accept, getColumns: getColumns };
}

export function padRowsToColumnCount(
  rows: string[][],
  columnCount: number,
): void {
  for (const row of rows) {
    while (row.length < columnCount) row.push("");
  }
}

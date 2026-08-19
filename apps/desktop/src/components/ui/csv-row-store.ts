export interface CsvRowStore {
  readonly rowCount: number;
  readonly version: number;
  getRow(index: number): string[] | undefined;
  materializeRows(): string[][];
}

export interface MutableCsvRowStore {
  appendRows(rows: string[][]): void;
  padRowsToColumnCount(columnCount: number): void;
  snapshot(): CsvRowStore;
  materializeRows(): string[][];
}

const EMPTY_CSV_ROW_STORE = createCsvRowStoreFromRows([]);

export function emptyCsvRowStore(): CsvRowStore {
  return EMPTY_CSV_ROW_STORE;
}

export function createCsvRowStoreFromRows(rows: string[][]): CsvRowStore {
  return {
    rowCount: rows.length,
    version: 0,
    getRow: (index) => rows[index],
    materializeRows: () => rows,
  };
}

export function createMutableCsvRowStore(): MutableCsvRowStore {
  const chunks: string[][][] = [];
  const starts: number[] = [];
  let rowCount = 0;
  let version = 0;

  function appendRows(rows: string[][]) {
    if (rows.length === 0) return;
    starts.push(rowCount);
    chunks.push(rows);
    rowCount += rows.length;
    version += 1;
  }

  function padRowsToColumnCount(columnCount: number) {
    for (const chunk of chunks) {
      for (const row of chunk) {
        while (row.length < columnCount) row.push("");
      }
    }
    version += 1;
  }

  function getRow(index: number): string[] | undefined {
    if (!Number.isSafeInteger(index) || index < 0 || index >= rowCount) {
      return undefined;
    }
    const chunkIndex = findChunkIndex(starts, index);
    const chunk = chunks[chunkIndex];
    return chunk?.[index - starts[chunkIndex]];
  }

  function materializeRows(): string[][] {
    return chunks.flat();
  }

  function snapshot(): CsvRowStore {
    const snapshotVersion = version;
    const snapshotRowCount = rowCount;
    return {
      rowCount: snapshotRowCount,
      version: snapshotVersion,
      getRow,
      materializeRows,
    };
  }

  return {
    appendRows,
    padRowsToColumnCount,
    snapshot,
    materializeRows,
  };
}

function findChunkIndex(starts: number[], rowIndex: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = starts[mid];
    const nextStart = starts[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (rowIndex < start) {
      high = mid - 1;
    } else if (rowIndex >= nextStart) {
      low = mid + 1;
    } else {
      return mid;
    }
  }
  return 0;
}

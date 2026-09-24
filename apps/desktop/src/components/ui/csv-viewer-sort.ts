export function isNumericCell(value: string): boolean {
  return value !== "" && !Number.isNaN(Number(value));
}

export function compareCsvCells(a: string, b: string): number {
  const aNumeric = isNumericCell(a);
  const bNumeric = isNumericCell(b);
  if (aNumeric && bNumeric) {
    const diff = Number(a) - Number(b);
    return diff < 0 ? -1 : diff > 0 ? 1 : 0;
  }
  // Numeric cells always sort ahead of text cells so the comparator stays a
  // total order regardless of which pairs are being compared.
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export type CsvSortKey =
  | {
      kind: "number";
      value: number;
      rowIndex: number;
    }
  | {
      kind: "text";
      value: string;
      rowIndex: number;
    };

/**
 * Returns the display order (source-row indices) for a column sort. Ascending
 * order follows `compareCsvCells`; descending negates it. Rows that compare
 * equal always keep their original relative order in *both* directions: a
 * naive `reverse()` of the ascending order would flip tied rows, so equal keys
 * fall back to the source index as a stable tiebreaker.
 */
export function sortedRowOrder(
  sourceRows: string[][],
  columnIndex: number,
  descending: boolean,
): number[] {
  return sortedRowOrderFromKeys(
    sourceRows.map((row, rowIndex) =>
      csvSortKey(row[columnIndex] ?? "", rowIndex),
    ),
    descending,
  );
}

export function csvSortKey(value: string, rowIndex: number): CsvSortKey {
  if (isNumericCell(value)) {
    return {
      kind: "number",
      value: Number(value),
      rowIndex,
    };
  }
  return {
    kind: "text",
    value,
    rowIndex,
  };
}

export function sortedRowOrderFromKeys(
  keys: CsvSortKey[],
  descending: boolean,
): number[] {
  const orderedKeys = keys.slice();
  const direction = descending ? -1 : 1;
  orderedKeys.sort((a, b) => {
    const cmp = compareCsvSortKeys(a, b);
    return cmp !== 0 ? direction * cmp : a.rowIndex - b.rowIndex;
  });
  return orderedKeys.map((key) => key.rowIndex);
}

function compareCsvSortKeys(a: CsvSortKey, b: CsvSortKey): number {
  if (a.kind === "number" && b.kind === "number") {
    const diff = a.value - b.value;
    return diff < 0 ? -1 : diff > 0 ? 1 : 0;
  }
  if (a.kind === "number") return -1;
  if (b.kind === "number") return 1;
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}

// Worker failures still yield to input between bounded merge chunks.
export async function sortedRowOrderCooperatively(keys: CsvSortKey[], descending: boolean, signal: AbortSignal): Promise<number[]> {
  let source = keys.slice();
  let target = new Array<CsvSortKey>(keys.length);
  let operations = 0;
  for (let width = 1; width < source.length; width *= 2) {
    for (let start = 0; start < source.length; start += width * 2) {
      const middle = Math.min(start + width, source.length);
      const end = Math.min(start + width * 2, source.length);
      let a = start, b = middle;
      for (let out = start; out < end; out++) {
        if (++operations % 4096 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        }
        const cmp = a < middle && b < end ? compareCsvSortKeys(source[a], source[b]) * (descending ? -1 : 1) : 0;
        target[out] = b >= end || (a < middle && (cmp < 0 || (cmp === 0 && source[a].rowIndex < source[b].rowIndex))) ? source[a++] : source[b++];
      }
    }
    [source, target] = [target, source];
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return source.map((key) => key.rowIndex);
}

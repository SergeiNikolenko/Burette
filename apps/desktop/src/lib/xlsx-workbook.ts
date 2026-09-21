export interface CompactSheet {
  name: string;
  rowCount: number;
  columnCount: number;
  /** Sorted row-major indexes for non-empty cells only. */
  cellIndexes: Uint32Array;
  /** Length cellIndexes.length + 1; cell i's text is text.slice(textOffsets[i], textOffsets[i + 1]). */
  textOffsets: Uint32Array;
  /** Length cellIndexes.length; 1 = numeric/date. */
  numericFlags: Uint8Array;
  /** All non-empty display texts concatenated in row-major order. */
  text: string;
}

export interface XlsxCell {
  /** Display text: the workbook's formatted value when available. */
  text: string;
  /** Right-align numbers and dates. */
  numeric: boolean;
}

export interface XlsxSheetMeta {
  name: string;
  rowCount: number;
  columnCount: number;
  nonEmptyCellCount: number;
}

export interface XlsxSource {
  sheets: XlsxSheetMeta[];
  getCell(sheetIndex: number, rowIndex: number, columnIndex: number): XlsxCell;
  dispose?: () => void;
  estimatedByteSize?: number;
}

export interface XlsxCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
}

export interface XlsxSheetChangeResult {
  accepted: boolean;
  changed: boolean;
  sheetIndex: number;
}

interface CacheEntry {
  promise: Promise<XlsxSource>;
  source?: XlsxSource;
  bytes: number;
}

export const EMPTY_XLSX_CELL: XlsxCell = { text: "", numeric: false };
const MAX_COMPACT_CELL_INDEX = 0xffffffff;

export function resolveXlsxSheetChange({
  activeSheet,
  requestedSheet,
  sheetCount,
}: {
  activeSheet: number;
  requestedSheet: number;
  sheetCount?: number | null;
}): XlsxSheetChangeResult {
  if (!Number.isSafeInteger(requestedSheet) || requestedSheet < 0) {
    return { accepted: false, changed: false, sheetIndex: activeSheet };
  }
  if (
    sheetCount != null &&
    (!Number.isSafeInteger(sheetCount) ||
      sheetCount < 0 ||
      requestedSheet >= sheetCount)
  ) {
    return { accepted: false, changed: false, sheetIndex: activeSheet };
  }
  return {
    accepted: true,
    changed: requestedSheet !== activeSheet,
    sheetIndex: requestedSheet,
  };
}

/** Spreadsheet column label: 0 -> A, 25 -> Z, 26 -> AA. */
export function xlsxColumnLabel(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) return "";
  let i = Math.floor(index) + 1;
  let label = "";
  while (i > 0) {
    const m = (i - 1) % 26;
    label = String.fromCharCode(65 + m) + label;
    i = Math.floor((i - 1) / 26);
  }
  return label;
}

export function compactSheetByteSize(sheet: CompactSheet): number {
  return (
    sheet.text.length * 2 +
    sheet.cellIndexes.byteLength +
    sheet.textOffsets.byteLength +
    sheet.numericFlags.byteLength
  );
}

export function estimateXlsxSourceBytes(source: XlsxSource): number {
  if (
    source.estimatedByteSize != null &&
    Number.isFinite(source.estimatedByteSize) &&
    source.estimatedByteSize >= 0
  ) {
    return source.estimatedByteSize;
  }
  return source.sheets.reduce(
    (sum, sheet) =>
      sum +
      sheet.name.length * 2 +
      // Metadata overhead is intentionally approximate; compact sheet buffers
      // dominate real workbook memory.
      32,
    0,
  );
}

export function estimateCompactWorkbookBytes(sheets: CompactSheet[]): number {
  return sheets.reduce((sum, sheet) => sum + compactSheetByteSize(sheet), 0);
}

export function getCompactSheetCell(
  sheet: CompactSheet | undefined,
  rowIndex: number,
  columnIndex: number,
): XlsxCell {
  if (
    !sheet ||
    !Number.isInteger(rowIndex) ||
    !Number.isInteger(columnIndex) ||
    rowIndex < 0 ||
    columnIndex < 0 ||
    rowIndex >= sheet.rowCount ||
    columnIndex >= sheet.columnCount
  ) {
    return EMPTY_XLSX_CELL;
  }

  const cellIndex = rowIndex * sheet.columnCount + columnIndex;
  const sparseIndex = binarySearchUint32(sheet.cellIndexes, cellIndex);
  if (sparseIndex < 0) return EMPTY_XLSX_CELL;

  const start = sheet.textOffsets[sparseIndex];
  const end = sheet.textOffsets[sparseIndex + 1];
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > sheet.text.length
  ) {
    return EMPTY_XLSX_CELL;
  }
  if (start === end) return EMPTY_XLSX_CELL;

  return {
    text: sheet.text.slice(start, end),
    numeric: sheet.numericFlags[sparseIndex] === 1,
  };
}

export function buildXlsxSourceFromCompact(
  compact: CompactSheet[],
): XlsxSource {
  const sheets: XlsxSheetMeta[] = compact.map((sheet) => ({
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    nonEmptyCellCount: sheet.cellIndexes.length,
  }));

  return {
    sheets,
    estimatedByteSize: estimateCompactWorkbookBytes(compact),
    getCell: (sheetIndex: number, rowIndex: number, columnIndex: number) =>
      getCompactSheetCell(compact[sheetIndex], rowIndex, columnIndex),
  };
}

export function createCompactSheet(input: {
  name: string;
  rowCount: number;
  columnCount: number;
  entries: Array<{ cellIndex: number; text: string; numeric?: boolean }>;
}): CompactSheet {
  const rowCount = normalizeCompactDimension(input.rowCount);
  const columnCount = normalizeCompactDimension(input.columnCount);
  const cellCapacity = rowCount * columnCount;
  const sorted = input.entries
    .filter(
      (entry) =>
        entry.text !== "" &&
        Number.isSafeInteger(entry.cellIndex) &&
        entry.cellIndex >= 0 &&
        entry.cellIndex <= MAX_COMPACT_CELL_INDEX &&
        entry.cellIndex < cellCapacity,
    )
    .sort((a, b) => a.cellIndex - b.cellIndex);
  const deduped: typeof sorted = [];
  for (const entry of sorted) {
    const previous = deduped[deduped.length - 1];
    if (previous?.cellIndex === entry.cellIndex) {
      deduped[deduped.length - 1] = entry;
    } else {
      deduped.push(entry);
    }
  }

  const cellIndexes = new Uint32Array(deduped.length);
  const textOffsets = new Uint32Array(deduped.length + 1);
  const numericFlags = new Uint8Array(deduped.length);
  const parts: string[] = [];
  let pos = 0;

  for (let i = 0; i < deduped.length; i++) {
    const entry = deduped[i];
    cellIndexes[i] = entry.cellIndex;
    textOffsets[i] = pos;
    parts.push(entry.text);
    pos += entry.text.length;
    if (entry.numeric) numericFlags[i] = 1;
  }
  textOffsets[deduped.length] = pos;

  return {
    name: input.name,
    rowCount,
    columnCount,
    cellIndexes,
    textOffsets,
    numericFlags,
    text: parts.join(""),
  };
}

export class XlsxSourceCache {
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(options: XlsxCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 4;
    this.maxBytes = options.maxBytes ?? 96 * 1024 * 1024;
  }

  get(loadKey: string, load: () => Promise<XlsxSource>): Promise<XlsxSource> {
    const existing = this.entries.get(loadKey);
    if (existing) {
      this.entries.delete(loadKey);
      this.entries.set(loadKey, existing);
      return existing.promise;
    }

    const entry: CacheEntry = {
      bytes: 0,
      promise: Promise.resolve()
        .then(load)
        .then(
          (source) => {
            if (this.entries.get(loadKey) !== entry) {
              source.dispose?.();
              return source;
            }
            entry.source = source;
            entry.bytes = estimateXlsxSourceBytes(source);
            this.evict();
            return source;
          },
          (error) => {
            if (this.entries.get(loadKey) === entry)
              this.entries.delete(loadKey);
            throw error;
          },
        ),
    };

    this.entries.set(loadKey, entry);
    this.evict();
    return entry.promise;
  }

  setResolvedForTest(loadKey: string, source: XlsxSource, bytes = 1): void {
    const entry: CacheEntry = {
      source,
      bytes,
      promise: Promise.resolve(source),
    };
    this.entries.set(loadKey, entry);
    this.evict();
  }

  has(loadKey: string): boolean {
    return this.entries.has(loadKey);
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.source?.dispose?.();
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  private evict(): void {
    let bytes = 0;
    for (const entry of this.entries.values()) bytes += entry.bytes;

    if (this.maxBytes > 0 && bytes > this.maxBytes) {
      for (const [key, entry] of this.entries) {
        if (bytes <= this.maxBytes) break;
        if (!entry.source) continue;
        this.entries.delete(key);
        bytes -= entry.bytes;
        entry.source.dispose?.();
      }
    }

    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(key);
      bytes -= entry.bytes;
      entry.source?.dispose?.();
    }
  }
}

function binarySearchUint32(items: Uint32Array, target: number): number {
  let lo = 0;
  let hi = items.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const value = items[mid];
    if (value === target) return mid;
    if (value < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function normalizeCompactDimension(value: number) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

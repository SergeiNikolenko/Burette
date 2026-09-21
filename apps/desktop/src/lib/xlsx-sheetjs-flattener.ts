import * as XLSX from "@e965/xlsx";

import { createCompactSheet, type CompactSheet } from "@/lib/xlsx-workbook";
import {
  XLSX_PARSE_LIMITS,
  XlsxWorkerError,
  type XlsxParseLimits,
} from "@/lib/xlsx-worker-protocol";

type SheetJsCell = {
  t?: string;
  v?: unknown;
  w?: unknown;
};

type SheetJsWorksheet = Record<string, SheetJsCell | string | undefined>;

type SheetJsWorkbook = {
  SheetNames: string[];
  Sheets: Record<string, SheetJsWorksheet | undefined>;
};

export function flattenSheetJsWorkbook(
  workbook: SheetJsWorkbook,
  limits: XlsxParseLimits = XLSX_PARSE_LIMITS,
): CompactSheet[] {
  return workbook.SheetNames.map((name) =>
    flattenSheetJsWorksheet(name, workbook.Sheets[name], limits),
  );
}

export function flattenSheetJsWorksheet(
  name: string,
  worksheet: SheetJsWorksheet | undefined,
  limits: XlsxParseLimits = XLSX_PARSE_LIMITS,
): CompactSheet {
  const ref = worksheet?.["!ref"];
  if (typeof ref !== "string") {
    return createEmptyCompactSheet(name);
  }
  const source = worksheet as SheetJsWorksheet;

  const range = XLSX.utils.decode_range(ref);
  if (!isValidDecodedRange(range)) return createEmptyCompactSheet(name);
  const rowCount = range.e.r + 1;
  const columnCount = range.e.c + 1;
  const maxIndex = rowCount * columnCount - 1;
  if (maxIndex > limits.maxRowMajorIndex) {
    throw new XlsxWorkerError(
      "range_too_large",
      `Spreadsheet range is too large to preview (${rowCount} rows x ${columnCount} columns)`,
    );
  }

  const entries: Array<{
    cellIndex: number;
    text: string;
    numeric?: boolean;
  }> = [];
  let textChars = 0;

  for (const key of Object.keys(source)) {
    if (key.charCodeAt(0) === 33) continue;
    const cell = source[key];
    if (!isSheetJsCell(cell)) continue;
    const { c: columnIndex, r: rowIndex } = XLSX.utils.decode_cell(key);
    if (
      rowIndex < range.s.r ||
      columnIndex < range.s.c ||
      rowIndex >= rowCount ||
      columnIndex >= columnCount
    ) {
      continue;
    }

    const text =
      cell.w != null ? String(cell.w) : cell.v != null ? String(cell.v) : "";
    if (text === "") continue;
    if (entries.length >= limits.maxNonEmptyCells) {
      throw new XlsxWorkerError(
        "too_many_cells",
        `Spreadsheet has too many non-empty cells to preview (>${limits.maxNonEmptyCells.toLocaleString()})`,
      );
    }
    textChars += text.length;
    if (textChars > limits.maxTextChars) {
      throw new XlsxWorkerError(
        "text_too_large",
        `Spreadsheet text is too large to preview (>${limits.maxTextChars.toLocaleString()} characters)`,
      );
    }

    entries.push({
      cellIndex: rowIndex * columnCount + columnIndex,
      text,
      numeric: cell.t === "n" || cell.t === "d",
    });
  }

  return createCompactSheet({
    name,
    rowCount,
    columnCount,
    entries,
  });
}

export function compactWorkbookTransferBuffers(
  sheets: CompactSheet[],
): ArrayBuffer[] {
  const transfer: ArrayBuffer[] = [];
  for (const sheet of sheets) {
    transfer.push(
      sheet.cellIndexes.buffer as ArrayBuffer,
      sheet.textOffsets.buffer as ArrayBuffer,
      sheet.numericFlags.buffer as ArrayBuffer,
    );
  }
  return transfer;
}

function isSheetJsCell(value: unknown): value is SheetJsCell {
  return value != null && typeof value === "object";
}

function createEmptyCompactSheet(name: string) {
  return createCompactSheet({
    name,
    rowCount: 0,
    columnCount: 0,
    entries: [],
  });
}

function isValidDecodedRange(range: XLSX.Range) {
  return (
    range.s.r >= 0 &&
    range.s.c >= 0 &&
    range.e.r >= range.s.r &&
    range.e.c >= range.s.c
  );
}

import type { CompactSheet } from "@/lib/xlsx-workbook";

export interface XlsxParseLimits {
  maxRowMajorIndex: number;
  maxNonEmptyCells: number;
  maxTextChars: number;
}

export const XLSX_PARSE_LIMITS: XlsxParseLimits = {
  maxRowMajorIndex: 0xffffffff,
  maxNonEmptyCells: 1_000_000,
  maxTextChars: 50_000_000,
};

export type XlsxWorkerErrorCode =
  | "parse_failed"
  | "range_too_large"
  | "too_many_cells"
  | "text_too_large";

export type XlsxWorkerRequest = {
  type: "parse_workbook";
  buffer: ArrayBuffer;
};

export type XlsxWorkerResponse =
  | { type: "workbook"; sheets: CompactSheet[] }
  | { type: "error"; message: string; code: XlsxWorkerErrorCode };

export class XlsxWorkerError extends Error {
  constructor(
    readonly code: XlsxWorkerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "XlsxWorkerError";
  }
}

// ZIP local-file-header variants ("PK\x03\x04", empty, and spanned archives)
// cover .xlsx/.xlsm/.xlsb/.ods. The OLE2 / Compound File Binary header covers
// legacy binary .xls.
const SPREADSHEET_CONTAINER_PREFIXES: ReadonlyArray<ReadonlyArray<number>> = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
];

function hasBytePrefix(
  bytes: Uint8Array,
  prefix: ReadonlyArray<number>,
): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * True when the buffer begins with a recognized spreadsheet container
 * signature: a ZIP archive (.xlsx/.xlsm/.xlsb/.ods) or an OLE2 compound file
 * (legacy .xls). This guards SheetJS's lenient format sniffer, which would
 * otherwise coerce arbitrary bytes — a mislabeled PDF, image, or text file —
 * into a degenerate single-cell sheet instead of surfacing a parse error.
 */
export function isSpreadsheetContainer(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  return SPREADSHEET_CONTAINER_PREFIXES.some((prefix) =>
    hasBytePrefix(bytes, prefix),
  );
}

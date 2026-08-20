import * as React from "react";

import type { ViewerDownloadAction } from "@/lib/viewer-download-actions";
import type {
  ViewerResource,
  ViewerResourceContent,
} from "@/lib/viewer-resource";
import type { XlsxSource } from "@/lib/xlsx-workbook";
import { type XlsxSheetMeta, xlsxColumnLabel } from "@/lib/xlsx-workbook";

import { serializeCsvTable } from "./csv-viewer-download";
import { getXlsxSource } from "./xlsx-viewer-resource";

const CSV_DIALECT = { delimiter: ",", hasHeader: true } as const;
const MAX_DENSE_CSV_EXPORT_CELLS = 1_000_000;

export function createXlsxSheetCsvExportAction({
  fileName,
  sheetIndex,
  getSource,
}: {
  fileName: string;
  sheetIndex: number;
  getSource: () => Promise<XlsxSource>;
}): ViewerDownloadAction {
  return {
    id: "xlsx-export-sheet",
    label: "Export sheet",
    fileName,
    origin: "derived",
    getPayload: async ({ signal } = {}) => {
      throwIfAborted(signal);
      const source = await getSource();
      throwIfAborted(signal);
      return {
        kind: "text",
        text: serializeXlsxSheetAsCsv({ source, sheetIndex, signal }),
        mimeType: "text/csv;charset=utf-8",
      };
    },
  };
}

export function xlsxSheetCsvFileName({
  fileName,
  sheetName,
  sheetCount,
}: {
  fileName: string;
  sheetName?: string;
  sheetCount?: number;
}) {
  const baseName = sanitizeFileNamePart(
    fileName.replace(/\.[^.\\/]+$/, "") || "spreadsheet",
    "spreadsheet",
  );
  if (!sheetName || sheetCount == null || sheetCount <= 1) {
    return `${baseName}.csv`;
  }
  return `${baseName}.${sanitizeFileNamePart(sheetName)}.csv`;
}

export function useXlsxDownloadActions({
  resource,
  activeSheet,
  activeSheetIndex,
  sheets,
  content,
}: {
  resource: ViewerResource;
  activeSheet: XlsxSheetMeta | null;
  activeSheetIndex: number;
  sheets: XlsxSheetMeta[] | null;
  content: ViewerResourceContent;
}) {
  return React.useMemo(() => {
    const originalDownloadAction = {
      ...resource.originalDownload,
      label: activeSheet ? "Download original" : "Download",
    };
    if (!activeSheet || !sheets) return [originalDownloadAction];
    return [
      originalDownloadAction,
      createXlsxSheetCsvExportAction({
        fileName: xlsxSheetCsvFileName({
          fileName: resource.fileName,
          sheetName: activeSheet.name,
          sheetCount: sheets.length,
        }),
        sheetIndex: activeSheetIndex,
        getSource: () => getXlsxSource(content),
      }),
    ];
  }, [
    activeSheet,
    activeSheetIndex,
    content,
    resource.fileName,
    resource.originalDownload,
    sheets,
  ]);
}

function serializeXlsxSheetAsCsv({
  source,
  sheetIndex,
  signal,
}: {
  source: XlsxSource;
  sheetIndex: number;
  signal?: AbortSignal;
}) {
  const sheet = source.sheets[sheetIndex];
  if (!sheet) return "";
  const rowCount = normalizeSheetDimension(sheet.rowCount);
  const columnCount = normalizeSheetDimension(sheet.columnCount);
  if (rowCount === 0 || columnCount === 0) return "";
  if (rowCount * columnCount > MAX_DENSE_CSV_EXPORT_CELLS) return "";

  const columns = Array.from({ length: columnCount }, (_, columnIndex) =>
    xlsxColumnLabel(columnIndex),
  );
  const sourceRows = Array.from({ length: rowCount }, (_, rowIndex) => {
    throwIfAborted(signal);
    return Array.from({ length: columnCount }, (_, columnIndex) => {
      const text = source.getCell(sheetIndex, rowIndex, columnIndex).text;
      throwIfAborted(signal);
      return text;
    });
  });

  return serializeCsvTable({ columns, sourceRows, dialect: CSV_DIALECT });
}

function normalizeSheetDimension(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function sanitizeFileNamePart(value: string, fallback = "sheet") {
  const sanitized = value.trim().replace(/[\x00-\x1f\x7f/\\?%*:|"<>]+/g, "-");
  return /[^\s.-]/u.test(sanitized) ? sanitized : fallback;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException("Download was cancelled.", "AbortError");
  }
}

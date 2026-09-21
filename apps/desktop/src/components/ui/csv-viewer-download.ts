import {
  isTabDelimited,
  normalizeCsvDelimiter,
  type CsvDialect,
} from "@/lib/csv";
import type { ViewerDownloadAction } from "@/lib/viewer-download-actions";
import type { ViewerResource } from "@/lib/viewer-resource";

export function escapeDelimitedField(value: string, delimiter: string): string {
  const text = value ?? "";
  return text.includes(delimiter) || /["\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

export function serializeCsvTable({
  columns,
  sourceRows,
  dialect,
}: {
  columns: string[];
  sourceRows: string[][];
  dialect: CsvDialect;
}): string {
  const delimiter =
    normalizeCsvDelimiter(dialect.delimiter) ?? dialect.delimiter;
  const lines = [
    columns
      .map((value) => escapeDelimitedField(value, delimiter))
      .join(delimiter),
  ];
  for (const sourceRow of sourceRows) {
    const row = fitExportRow(sourceRow, columns.length);
    lines.push(
      row
        .map((value) => escapeDelimitedField(value, delimiter))
        .join(delimiter),
    );
  }
  return lines.join("\r\n");
}

function fitExportRow(row: string[], columnCount: number): string[] {
  const out = row.slice(0, columnCount);
  while (out.length < columnCount) out.push("");
  return out;
}

export function defaultCsvDownloadName(dialect: CsvDialect): string {
  return isTabDelimited(dialect) ? "data.tsv" : "data.csv";
}

export function createCsvExportAction({
  columns,
  sourceRows,
  dialect,
  fileName,
  isDisabled,
}: {
  columns: string[];
  sourceRows: string[][];
  dialect: CsvDialect;
  fileName: string;
  isDisabled?: boolean;
}): ViewerDownloadAction {
  return {
    id: "csv-export-table",
    label: "Export table",
    fileName,
    origin: "derived",
    isDisabled,
    getPayload: () => ({
      kind: "text",
      text: serializeCsvTable({ columns, sourceRows, dialect }),
      mimeType: isTabDelimited(dialect)
        ? "text/tab-separated-values;charset=utf-8"
        : "text/csv;charset=utf-8",
    }),
  };
}

export function csvViewerDownloadActions({
  resource,
  columns,
  sourceRows,
  dialect,
  fileName,
  canExportTable,
}: {
  resource: ViewerResource | null;
  columns: string[];
  sourceRows: string[][];
  dialect: CsvDialect;
  fileName: string;
  canExportTable: boolean;
}): ViewerDownloadAction[] {
  const actions: ViewerDownloadAction[] = [];
  if (resource) {
    actions.push({
      ...resource.originalDownload,
      label: "Download original",
    });
  }
  actions.push(
    createCsvExportAction({
      columns,
      sourceRows,
      dialect,
      fileName,
      isDisabled: !canExportTable,
    }),
  );
  return actions;
}

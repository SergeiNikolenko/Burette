import { resolveCsvDialect, type CsvDialect, type CsvTable } from "@/lib/csv";
import type {
  ViewerContentPayload,
  ViewerContentBlob,
  ViewerContentStream,
  ViewerResource,
} from "@/lib/viewer-resource";
import { viewerContentRenderKey } from "@/lib/viewer-resource";
import type {
  BlobViewerSource,
  TextSource,
  UrlViewerSource,
} from "@/lib/viewer-source";
import { textPayloadKey } from "@/lib/viewer-source";

export type CsvContent = ViewerContentPayload &
  ViewerContentBlob &
  ViewerContentStream;

export type CsvResource =
  | { kind: "resource"; content: CsvContent }
  | { kind: "text"; text: string }
  | { kind: "table"; table: CsvTable; fileName?: string }
  | { kind: "empty" };

export type CsvDocumentSource = UrlViewerSource | BlobViewerSource | TextSource;

export interface CsvTableSource {
  kind: "table";
  table: CsvTable;
  fileName?: string;
  identityKey?: string;
  dialect?: CsvDialect;
}

export type CsvViewerSource = CsvDocumentSource | CsvTableSource;

export interface CsvResourceInput {
  source?: CsvViewerSource;
  resource?: ViewerResource | null;
}

export interface CsvViewerDialectInput {
  dialect?: CsvDialect;
  source?: CsvViewerSource;
  resource?: ViewerResource | null;
}

export function isCsvDocumentSource(
  source: CsvViewerSource,
): source is CsvDocumentSource {
  return source.kind !== "table";
}

export function resolveCsvResource({
  source,
  resource,
}: CsvResourceInput): CsvResource {
  if (source?.kind === "table") {
    return {
      kind: "table",
      table: source.table,
      fileName: source.fileName,
    };
  }
  if (resource) {
    if (resource.content.payload.kind === "text") {
      return { kind: "text", text: resource.content.payload.text };
    }
    return { kind: "resource", content: resource.content };
  }
  return { kind: "empty" };
}

export function resolveCsvViewerDialect({
  dialect,
  source,
  resource,
}: CsvViewerDialectInput): CsvDialect {
  const tableDialect = source?.kind === "table" ? source.dialect : undefined;
  const tableFileName = source?.kind === "table" ? source.fileName : undefined;
  return resolveCsvDialect({
    dialect: dialect ?? tableDialect,
    descriptor: {
      src: resource?.content.directUrl ?? undefined,
      fileName: resource?.fileName ?? tableFileName,
      mimeType: resource?.mimeType,
    },
  });
}

export function csvViewerSortResetKey({
  dialect,
  source,
  resource,
}: {
  dialect: CsvDialect;
  source?: CsvViewerSource;
  resource?: ViewerResource | null;
}): unknown {
  const dialectKey = `${dialect.delimiter}\u0000${dialect.hasHeader}`;
  if (source?.kind === "text") {
    return `${source.identityKey ?? ""}\u0000${textPayloadKey(source.text)}\u0000${dialectKey}`;
  }
  if (resource) {
    return `${resource.keys.load}\u0000${viewerContentRenderKey(resource.content)}\u0000${dialectKey}`;
  }
  if (source?.kind === "table") return source.identityKey ?? source.table;
  return "empty";
}

export function csvViewerExportFileName({
  dialect,
  source,
  resource,
  fallback,
}: {
  dialect: CsvDialect;
  source?: CsvViewerSource;
  resource?: ViewerResource | null;
  fallback: (dialect: CsvDialect) => string;
}): string {
  const tableFileName = source?.kind === "table" ? source.fileName : undefined;
  return resource?.fileName ?? tableFileName ?? fallback(dialect);
}

export interface CsvDialect {
  delimiter: string;
  hasHeader: boolean;
}

export interface CsvDialectDescriptor {
  src?: string;
  fileName?: string;
  mimeType?: string;
}

export const DEFAULT_CSV_DIALECT: CsvDialect = {
  delimiter: ",",
  hasHeader: true,
};

export function normalizeCsvDelimiter(
  delimiter: string | undefined,
): string | undefined {
  return delimiter === "\\t" ? "\t" : delimiter;
}

/**
 * Normalizes a delimiter and discards values the parser cannot honor. A CSV
 * delimiter must be exactly one character: the incremental parser matches a
 * field separator one character at a time (`c === delimiter`), so an empty
 * delimiter makes it fall back to a comma (`delimiter || ","`) while a
 * multi-character delimiter (e.g. `"::"`) never matches at all and collapses
 * every row into a single field. In both cases the exporter would still join
 * with the unusable delimiter, producing output the parser cannot read back.
 * Callers must never let either through, so anything other than a single
 * character is discarded here and resolution falls back to the inferred dialect.
 */
function usableDelimiter(delimiter: string | undefined): string | undefined {
  const normalized = normalizeCsvDelimiter(delimiter);
  return normalized && normalized.length === 1 ? normalized : undefined;
}

export function extensionOfDelimitedName(name: string): string | null {
  const clean = name.split(/[?#]/)[0];
  const base = clean.split("/").pop() ?? clean;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : null;
}

export function inferCsvDialect({
  src,
  fileName,
  mimeType,
}: CsvDialectDescriptor): CsvDialect {
  const name = fileName ?? src ?? "";
  const ext = extensionOfDelimitedName(name);
  if (ext === "tsv") return { delimiter: "\t", hasHeader: true };
  if (ext === "csv") return DEFAULT_CSV_DIALECT;

  const normalizedMime = mimeType?.toLowerCase().split(";")[0].trim();
  if (normalizedMime === "text/tab-separated-values") {
    return { delimiter: "\t", hasHeader: true };
  }
  return DEFAULT_CSV_DIALECT;
}

export function resolveCsvDialect({
  dialect,
  delimiter,
  hasHeader,
  descriptor,
}: {
  dialect?: CsvDialect;
  delimiter?: string;
  hasHeader?: boolean;
  descriptor: CsvDialectDescriptor;
}): CsvDialect {
  const inferred = dialect ?? inferCsvDialect(descriptor);
  return {
    delimiter:
      usableDelimiter(delimiter) ??
      usableDelimiter(inferred.delimiter) ??
      DEFAULT_CSV_DIALECT.delimiter,
    hasHeader: hasHeader ?? inferred.hasHeader,
  };
}

export function isTabDelimited(dialect: CsvDialect): boolean {
  return normalizeCsvDelimiter(dialect.delimiter) === "\t";
}

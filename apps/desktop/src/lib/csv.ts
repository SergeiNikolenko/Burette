import {
  createCsvNormalizer,
  padRowsToColumnCount,
  type CsvNormalizer,
} from "./csv-normalizer";
import { createCsvParser } from "./csv-parser";

export {
  DEFAULT_CSV_DIALECT,
  extensionOfDelimitedName,
  inferCsvDialect,
  isTabDelimited,
  normalizeCsvDelimiter,
  resolveCsvDialect,
  type CsvDialect,
  type CsvDialectDescriptor,
} from "./csv-dialect";
export {
  createCsvNormalizer,
  padRowsToColumnCount,
  type CsvNormalizer,
  type CsvNormalizerOptions,
  type CsvTable,
  type CsvTableEvent,
} from "./csv-normalizer";
export {
  createCsvParser,
  type CsvParser,
  type CsvParserOptions,
} from "./csv-parser";

export interface ParsedCsv {
  columns: string[];
  rows: string[][];
}

export interface ParseCsvOptions {
  /** Field delimiter. Defaults to ",". */
  delimiter?: string;
  /** Treat the first record as a header row. Defaults to true. */
  hasHeader?: boolean;
}

export function parseCsv(
  input: string,
  options: ParseCsvOptions = {},
): ParsedCsv {
  const parser = createCsvParser({ delimiter: options.delimiter });
  const normalizer = createCsvNormalizer({ hasHeader: options.hasHeader });
  const rows: string[][] = [];
  let columns: string[] = [];

  handleCsvRecords(parser.push(input), normalizer, rows, (nextColumns) => {
    columns = nextColumns;
    padRowsToColumnCount(rows, columns.length);
  });
  handleCsvRecords(parser.flush(), normalizer, rows, (nextColumns) => {
    columns = nextColumns;
    padRowsToColumnCount(rows, columns.length);
  });

  return { columns, rows };
}

function handleCsvRecords(
  records: string[][],
  normalizer: CsvNormalizer,
  rows: string[][],
  onColumns: (columns: string[]) => void,
) {
  for (const record of records) {
    for (const event of normalizer.accept(record)) {
      if (event.type === "columns") {
        onColumns(event.columns);
      } else {
        rows.push(event.row);
      }
    }
  }
}

/** Pad a record to a fixed width. */
export function fitRow(row: string[], width: number): string[] {
  if (row.length === width) return row;
  if (row.length < width)
    return [...row, ...Array(width - row.length).fill("")];
  return row;
}

export interface CsvStreamHandlers {
  onColumns: (columns: string[]) => void;
  onRows: (rows: string[][]) => void;
  onDone?: () => void;
  onError?: (error: unknown) => void;
}

export interface CsvStreamOptions extends ParseCsvOptions {
  /** Rows per batch handed to `onRows`. Defaults to 2000. */
  batchSize?: number;
  signal?: AbortSignal;
}

export type CsvStreamSource =
  | Blob
  | string
  | ReadableStream<Uint8Array>
  | AsyncIterable<string>;

export async function streamCsv(
  source: CsvStreamSource,
  handlers: CsvStreamHandlers,
  options: CsvStreamOptions = {},
): Promise<void> {
  const batchSize = options.batchSize ?? 2000;
  const signal = options.signal;
  const parser = createCsvParser({ delimiter: options.delimiter });
  const normalizer = createCsvNormalizer({ hasHeader: options.hasHeader });
  let batch: string[][] = [];

  const handleRecords = (records: string[][]) => {
    for (const record of records) {
      for (const event of normalizer.accept(record)) {
        if (event.type === "columns") {
          handlers.onColumns(event.columns);
          padRowsToColumnCount(batch, event.columns.length);
        } else {
          batch.push(event.row);
        }
      }
      if (batch.length >= batchSize) {
        handlers.onRows(batch);
        batch = [];
      }
    }
  };

  try {
    let lastYield = performance.now();
    for await (const chunk of readTextChunks(source)) {
      if (signal?.aborted) return;
      handleRecords(parser.push(chunk));
      if (performance.now() - lastYield > 12) {
        await new Promise((resolve) => setTimeout(resolve));
        lastYield = performance.now();
      }
    }
    if (signal?.aborted) return;
    handleRecords(parser.flush());
    if (batch.length) handlers.onRows(batch);
    handlers.onDone?.();
  } catch (error) {
    handlers.onError?.(error);
  }
}

async function* readTextChunks(
  source: CsvStreamSource,
): AsyncGenerator<string> {
  if (typeof source === "string") {
    const size = 1 << 20;
    for (let offset = 0; offset < source.length; offset += size) {
      yield source.slice(offset, offset + size);
    }
    return;
  }
  if (
    typeof ReadableStream !== "undefined" &&
    source instanceof ReadableStream
  ) {
    yield* decodeByteStream(source);
    return;
  }
  if (Symbol.asyncIterator in Object(source)) {
    for await (const chunk of source as AsyncIterable<string>) yield chunk;
    return;
  }
  const blob = source as Blob;
  if (typeof blob.stream === "function") {
    yield* decodeByteStream(blob.stream());
    return;
  }
  yield await blob.text();
}

async function* decodeByteStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const text = decoder.decode(value, { stream: true });
        if (text) yield text;
      }
    }
    const rest = decoder.decode();
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}

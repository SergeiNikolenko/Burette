import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import {
  parseCsv,
  streamCsv,
  type CsvDialect,
  type CsvStreamSource,
} from "@/lib/csv";
import {
  isAbortError,
  isResourceError,
  ResourceError,
} from "@/lib/viewer-errors";

import {
  resolveCsvResource,
  type CsvResource,
  type CsvResourceInput,
} from "./csv-viewer-resource";
import {
  createCsvRowStoreFromRows,
  createMutableCsvRowStore,
  emptyCsvRowStore,
  type CsvRowStore,
} from "./csv-row-store";
import {
  CsvWorkerUnavailableError,
  parseCsvInWorker,
  toCsvFormatError,
} from "./csv-viewer-worker";
import type { GridCellCoordinate } from "./fixed-grid-selection";
import { joinEffectKey } from "@/lib/effect-key";

const CSV_STREAM_BATCH_SIZE = 5000;
const SYNC_TEXT_PARSE_MAX_BYTES = 256 * 1024;

export type CsvCellAddress = GridCellCoordinate;

export type CsvResourceState =
  | {
      status: "idle";
      columns: string[];
      sourceRows: string[][];
      rowStore: CsvRowStore;
    }
  | {
      status: "loading";
      columns: string[];
      sourceRows: string[][];
      rowStore: CsvRowStore;
    }
  | {
      status: "ready";
      columns: string[];
      sourceRows: string[][];
      rowStore: CsvRowStore;
    }
  | {
      status: "empty";
      columns: string[];
      sourceRows: string[][];
      rowStore: CsvRowStore;
    }
  | {
      status: "error";
      columns: string[];
      sourceRows: string[][];
      rowStore: CsvRowStore;
      error: unknown;
    };

export function readyCsvState(
  columns: string[],
  sourceRows: string[][],
): CsvResourceState {
  const rowStore = createCsvRowStoreFromRows(sourceRows);
  return sourceRows.length === 0
    ? { status: "empty", columns, sourceRows, rowStore }
    : { status: "ready", columns, sourceRows, rowStore };
}

export function useCsvResourceState({
  source,
  resource,
  dialect,
  retryVersion = 0,
}: CsvResourceInput & {
  dialect: CsvDialect;
  retryVersion?: number;
}): CsvResourceState {
  const content = resource?.content ?? null;
  const { delimiter, hasHeader } = dialect;
  const csvDialect = React.useMemo(
    () => ({ delimiter, hasHeader }),
    [delimiter, hasHeader],
  );
  const tableSource = source?.kind === "table" ? source : null;
  const textSource = source?.kind === "text" ? source : null;
  const csvResource = React.useMemo<CsvResource>(() => {
    if (tableSource) {
      return resolveCsvResource({ source: tableSource });
    }
    if (textSource) {
      return { kind: "text", text: textSource.text };
    }
    if (!content) {
      return { kind: "empty" };
    }
    if (content.payload.kind === "text") {
      return { kind: "text", text: content.payload.text };
    }
    return { kind: "resource", content };
  }, [tableSource, textSource, content]);
  const syncState = React.useMemo<CsvResourceState | null>(() => {
    if (csvResource.kind === "table") {
      return readyCsvState(csvResource.table.columns, csvResource.table.rows);
    }
    if (csvResource.kind === "text") {
      if (csvResource.text.length > SYNC_TEXT_PARSE_MAX_BYTES) return null;
      const table = parseCsv(csvResource.text, csvDialect);
      return readyCsvState(table.columns, table.rows);
    }
    if (csvResource.kind === "empty") {
      return {
        status: "idle",
        columns: [],
        sourceRows: [],
        rowStore: emptyCsvRowStore(),
      };
    }
    return null;
  }, [csvResource, csvDialect]);

  const [state, setState] = React.useState<CsvResourceState>({
    status: "idle",
    columns: [],
    sourceRows: [],
    rowStore: emptyCsvRowStore(),
  });

  const resourceEffectKey =
    syncState ||
    (csvResource.kind !== "resource" && csvResource.kind !== "text")
      ? null
      : joinEffectKey(["csv-resource", csvResource, csvDialect, retryVersion]);
  useKeyedMountEffect(resourceEffectKey, () => {
    if (syncState) return;
    if (csvResource.kind !== "resource" && csvResource.kind !== "text") return;

    const controller = new AbortController();
    const rowStore = createMutableCsvRowStore();
    let columns: string[] = [];
    let cancelled = false;
    setState({
      status: "loading",
      columns: [],
      sourceRows: [],
      rowStore: rowStore.snapshot(),
    });

    const onColumns = (next: string[]) => {
      if (cancelled) return;
      columns = next;
      rowStore.padRowsToColumnCount(columns.length);
      setState({
        status: "loading",
        columns,
        sourceRows: [],
        rowStore: rowStore.snapshot(),
      });
    };

    const onSourceRows = (sourceRowBatch: string[][]) => {
      if (cancelled) return;
      rowStore.appendRows(sourceRowBatch);
      setState({
        status: "loading",
        columns,
        sourceRows: [],
        rowStore: rowStore.snapshot(),
      });
    };

    const onDone = () => {
      if (cancelled) return;
      setState(readyCsvState(columns, rowStore.materializeRows()));
    };

    const onError = (error: unknown) => {
      if (cancelled || controller.signal.aborted) return;
      const sourceRows = rowStore.materializeRows();
      setState({
        status: "error",
        columns,
        sourceRows,
        rowStore: createCsvRowStoreFromRows(sourceRows),
        error: toCsvPreviewError(error),
      });
    };

    const runMainThread = (input: CsvStreamSource) => {
      void streamCsv(
        input,
        { onColumns, onRows: onSourceRows, onDone, onError },
        {
          delimiter: csvDialect.delimiter,
          hasHeader: csvDialect.hasHeader,
          batchSize: CSV_STREAM_BATCH_SIZE,
          signal: controller.signal,
        },
      );
    };

    const runResource = async () => {
      try {
        if (csvResource.kind === "text") {
          const textBlob = new Blob([csvResource.text], { type: "text/csv" });
          if (typeof Worker !== "undefined") {
            void parseCsvInWorker({
              source: textBlob,
              dialect: csvDialect,
              batchSize: CSV_STREAM_BATCH_SIZE,
              onColumns,
              onSourceRows,
              signal: controller.signal,
            }).then(onDone, (error) => {
              if (error instanceof CsvWorkerUnavailableError) {
                runMainThread(csvResource.text);
              } else {
                onError(error);
              }
            });
            return;
          }

          runMainThread(csvResource.text);
          return;
        }

        if (csvResource.content.payload.kind === "blob") {
          const { blob } = csvResource.content.payload;
          if (typeof Worker !== "undefined") {
            void parseCsvInWorker({
              source: blob,
              dialect: csvDialect,
              batchSize: CSV_STREAM_BATCH_SIZE,
              onColumns,
              onSourceRows,
              signal: controller.signal,
            }).then(onDone, (error) => {
              if (error instanceof CsvWorkerUnavailableError) {
                runMainThread(blob);
              } else {
                onError(error);
              }
            });
            return;
          }

          runMainThread(blob);
          return;
        }

        if (
          csvResource.content.payload.kind === "url" &&
          typeof Worker !== "undefined"
        ) {
          void csvResource.content
            .readBlob({ cache: "no-store", signal: controller.signal })
            .then((blob) =>
              parseCsvInWorker({
                source: blob,
                dialect: csvDialect,
                batchSize: CSV_STREAM_BATCH_SIZE,
                onColumns,
                onSourceRows,
                signal: controller.signal,
              }),
            )
            .then(onDone, (error) => {
              if (error instanceof CsvWorkerUnavailableError) {
                void runResourceStream();
              } else {
                onError(error);
              }
            });
          return;
        }

        await runResourceStream();
      } catch (error) {
        onError(error);
      }
    };

    const runResourceStream = async () => {
      if (csvResource.kind !== "resource") return;
      try {
        const cache =
          csvResource.content.payload.kind === "url" ? "no-store" : undefined;
        runMainThread(
          await csvResource.content.readStream(
            cache
              ? { cache, signal: controller.signal }
              : { signal: controller.signal },
          ),
        );
      } catch (error) {
        onError(error);
      }
    };

    void runResource();

    return () => {
      cancelled = true;
      controller.abort();
    };
  });

  return syncState ?? state;
}

function toCsvPreviewError(error: unknown): Error {
  if (isResourceError(error)) return error;
  if (isAbortError(error)) {
    return new ResourceError({
      kind: "aborted",
      message: "Loading was cancelled.",
      cause: error,
    });
  }
  return toCsvFormatError(error);
}

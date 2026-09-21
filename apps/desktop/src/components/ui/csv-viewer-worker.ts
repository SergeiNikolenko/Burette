import type { CsvDialect } from "@/lib/csv";
import {
  isViewerFormatError,
  ViewerFormatError,
  type ViewerFormatErrorMapperOptions,
} from "@/lib/viewer-errors";

export class CsvWorkerUnavailableError extends Error {
  constructor(message = "CSV worker unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "CsvWorkerUnavailableError";
  }
}

export function toCsvFormatError(
  error: unknown,
  options: ViewerFormatErrorMapperOptions = {
    kind: "parse_failed",
    message: "Failed to parse CSV.",
  },
): ViewerFormatError {
  if (isViewerFormatError(error)) return error;
  return new ViewerFormatError({
    format: "csv",
    kind: options.kind,
    message: options.message,
    cause: error,
  });
}

export interface CsvWorkerRequest {
  parseRequestId: string;
  source: Blob;
  dialect: CsvDialect;
  batchSize: number;
}

export type CsvWorkerResponse =
  | { type: "columns"; parseRequestId: string; columns: string[] }
  | { type: "sourceRows"; parseRequestId: string; sourceRows: string[][] }
  | { type: "done"; parseRequestId: string }
  | { type: "error"; parseRequestId: string; message: string };

export function createCsvWorker(): Worker {
  return new Worker(new URL("./csv-viewer.worker.ts", import.meta.url), {
    type: "module",
  });
}

export function parseCsvInWorker({
  source,
  dialect,
  batchSize,
  onColumns,
  onSourceRows,
  signal,
}: {
  source: Blob;
  dialect: CsvDialect;
  batchSize: number;
  onColumns: (columns: string[]) => void;
  onSourceRows: (sourceRows: string[][]) => void;
  signal: AbortSignal;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = createCsvWorker();
    } catch (error) {
      reject(
        new CsvWorkerUnavailableError("CSV worker unavailable", {
          cause: error,
        }),
      );
      return;
    }

    const parseRequestId = crypto.randomUUID();
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      cleanup();
      reject(
        toCsvFormatError(event, {
          kind: "worker_failed",
          message: event?.message || "CSV worker failed.",
        }),
      );
    };
    worker.onmessage = (event: MessageEvent<CsvWorkerResponse>) => {
      const message = event.data;
      if (message.parseRequestId !== parseRequestId) return;
      if (message.type === "columns") onColumns(message.columns);
      else if (message.type === "sourceRows") onSourceRows(message.sourceRows);
      else if (message.type === "done") {
        cleanup();
        resolve();
      } else {
        cleanup();
        reject(
          toCsvFormatError(undefined, {
            kind: "parse_failed",
            message: message.message || "Failed to parse CSV.",
          }),
        );
      }
    };

    const request: CsvWorkerRequest = {
      parseRequestId,
      source,
      dialect,
      batchSize,
    };
    worker.postMessage(request);
  });
}

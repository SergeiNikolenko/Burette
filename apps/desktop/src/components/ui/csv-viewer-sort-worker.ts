import { sortedRowOrder } from "./csv-viewer-sort";

export class CsvSortWorkerUnavailableError extends Error {
  constructor(message = "CSV sort worker unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "CsvSortWorkerUnavailableError";
  }
}

export interface CsvSortWorkerRequest {
  sortRequestId: string;
  sourceRows: string[][];
  columnIndex: number;
  descending: boolean;
}

export type CsvSortWorkerResponse =
  | { type: "rowOrder"; sortRequestId: string; rowOrder: number[] }
  | { type: "error"; sortRequestId: string; message: string };

export function createCsvSortWorker(): Worker {
  return new Worker(new URL("./csv-viewer-sort.worker.ts", import.meta.url), {
    type: "module",
  });
}

export function sortCsvRowsInWorker({
  sourceRows,
  columnIndex,
  descending,
  signal,
}: {
  sourceRows: string[][];
  columnIndex: number;
  descending: boolean;
  signal: AbortSignal;
}): Promise<number[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = createCsvSortWorker();
    } catch (error) {
      reject(
        new CsvSortWorkerUnavailableError("CSV sort worker unavailable", {
          cause: error,
        }),
      );
      return;
    }

    const sortRequestId = crypto.randomUUID();
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
      reject(new Error(event?.message || "CSV sort worker failed."));
    };
    worker.onmessage = (event: MessageEvent<CsvSortWorkerResponse>) => {
      const message = event.data;
      if (message.sortRequestId !== sortRequestId) return;
      if (message.type === "rowOrder") {
        cleanup();
        resolve(message.rowOrder);
      } else {
        cleanup();
        reject(new Error(message.message || "CSV sort failed."));
      }
    };

    worker.postMessage({
      sortRequestId,
      sourceRows,
      columnIndex,
      descending,
    } satisfies CsvSortWorkerRequest);
  });
}

export function sortCsvRowsOnMainThread({
  sourceRows,
  columnIndex,
  descending,
}: {
  sourceRows: string[][];
  columnIndex: number;
  descending: boolean;
}): number[] {
  return sortedRowOrder(sourceRows, columnIndex, descending);
}

import { type CsvSortKey } from "./csv-viewer-sort";

export interface CsvSortWorkerRequest {
  sortRequestId: string;
  keys: CsvSortKey[];
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

export function sortCsvRowsInWorker({ worker, keys, descending, signal }: {
  worker: Worker;
  keys: CsvSortKey[];
  descending: boolean;
  signal: AbortSignal;
}): Promise<number[]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const sortRequestId = crypto.randomUUID();
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("message", onMessage);
    };
    const abort = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    const onError = (event: ErrorEvent) => { cleanup(); reject(new Error(event.message || "CSV sort worker failed")); };
    const onMessage = (event: MessageEvent<CsvSortWorkerResponse>) => {
      const message = event.data;
      if (message.sortRequestId !== sortRequestId) return;
      cleanup();
      if (message.type === "rowOrder") resolve(message.rowOrder);
      else reject(new Error(message.message));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.addEventListener("error", onError);
    worker.addEventListener("message", onMessage);
    try { worker.postMessage({ sortRequestId, keys, descending } satisfies CsvSortWorkerRequest); }
    catch (error) { cleanup(); reject(error); }
  });
}

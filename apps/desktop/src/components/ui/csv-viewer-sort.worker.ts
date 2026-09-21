import type {
  CsvSortWorkerRequest,
  CsvSortWorkerResponse,
} from "./csv-viewer-sort-worker";
import { sortedRowOrder } from "./csv-viewer-sort";

function post(message: CsvSortWorkerResponse) {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<CsvSortWorkerRequest>) => {
  const { sortRequestId, sourceRows, columnIndex, descending } = event.data;
  try {
    post({
      type: "rowOrder",
      sortRequestId,
      rowOrder: sortedRowOrder(sourceRows, columnIndex, descending),
    });
  } catch (error) {
    post({
      type: "error",
      sortRequestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

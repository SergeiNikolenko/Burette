import * as XLSX from "@e965/xlsx";

import {
  compactWorkbookTransferBuffers,
  flattenSheetJsWorkbook,
} from "@/lib/xlsx-sheetjs-flattener";
import {
  isSpreadsheetContainer,
  XlsxWorkerError,
  type XlsxWorkerRequest,
  type XlsxWorkerResponse,
} from "@/lib/xlsx-worker-protocol";

// Cast the worker global to `Worker` so `onmessage`/`postMessage` type-check
// under the DOM lib without pulling in the conflicting "webworker" lib.
const ctx = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent<XlsxWorkerRequest>) => {
  try {
    if (event.data.type !== "parse_workbook") {
      throw new XlsxWorkerError(
        "parse_failed",
        "Unsupported spreadsheet request",
      );
    }

    // SheetJS sniffs arbitrary bytes into a stub sheet rather than failing, so
    // reject anything that is not a real spreadsheet container up front.
    if (!isSpreadsheetContainer(event.data.buffer)) {
      throw new XlsxWorkerError(
        "parse_failed",
        "File is not a recognized spreadsheet (.xlsx or .xls).",
      );
    }

    // cellDates formats dates as text in `.w`; we never need styles or formulae.
    const workbook = XLSX.read(event.data.buffer, {
      type: "array",
      cellDates: true,
    });
    const sheets = flattenSheetJsWorkbook(workbook);
    const response: XlsxWorkerResponse = { type: "workbook", sheets };
    ctx.postMessage(response, compactWorkbookTransferBuffers(sheets));
  } catch (error) {
    const response: XlsxWorkerResponse = {
      type: "error",
      code: error instanceof XlsxWorkerError ? error.code : "parse_failed",
      message:
        error instanceof Error ? error.message : "Failed to parse spreadsheet",
    };
    ctx.postMessage(response);
  }
};

import {
  isResourceError,
  isViewerFormatError,
  ViewerFormatError,
  type ViewerFormatErrorMapperOptions,
} from "@/lib/viewer-errors";
import type { ViewerContentBytes } from "@/lib/viewer-resource";
import {
  buildXlsxSourceFromCompact,
  XlsxSourceCache,
  type CompactSheet,
  type XlsxSource,
} from "@/lib/xlsx-workbook";
import {
  type XlsxWorkerRequest,
  type XlsxWorkerResponse,
} from "@/lib/xlsx-worker-protocol";

const sourceCache = new XlsxSourceCache({ maxEntries: 4 });

export function getXlsxSource(
  content: ViewerContentBytes,
): Promise<XlsxSource> {
  return sourceCache.get(content.key, () => buildXlsxSource(content));
}

async function buildXlsxSource(
  content: ViewerContentBytes,
): Promise<XlsxSource> {
  try {
    const buffer = await content.readBytes();
    return buildXlsxSourceFromCompact(await parseWorkbookInWorker(buffer));
  } catch (error) {
    if (isResourceError(error)) throw error;
    throw toXlsxFormatError(error, {
      kind: "parse_failed",
      message: "Failed to parse spreadsheet.",
    });
  }
}

function toXlsxFormatError(
  error: unknown,
  options: ViewerFormatErrorMapperOptions,
): ViewerFormatError {
  if (isViewerFormatError(error)) return error;
  return new ViewerFormatError({
    format: "xlsx",
    kind: options.kind,
    message: options.message,
    cause: error,
  });
}

function parseWorkbookInWorker(buffer: ArrayBuffer): Promise<CompactSheet[]> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === "undefined") {
      reject(
        toXlsxFormatError(undefined, {
          kind: "worker_failed",
          message: "Web Workers are unavailable in this environment.",
        }),
      );
      return;
    }

    const worker = new Worker(
      new URL("./xlsx-viewer.worker", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<unknown>) => {
      worker.terminate();
      const response = parseXlsxWorkerResponse(event.data);
      if (!response) {
        reject(
          toXlsxFormatError(undefined, {
            kind: "parse_failed",
            message: "Spreadsheet worker returned an invalid response.",
          }),
        );
        return;
      }
      if (response.type === "workbook") {
        resolve(response.sheets);
      } else {
        reject(
          toXlsxFormatError(undefined, {
            kind: "parse_failed",
            message: response.message || "Failed to parse spreadsheet.",
          }),
        );
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(
        toXlsxFormatError(event, {
          kind: "worker_failed",
          message: event.message || "Spreadsheet worker failed.",
        }),
      );
    };
    const request: XlsxWorkerRequest = { type: "parse_workbook", buffer };
    worker.postMessage(request, [buffer]);
  });
}

function parseXlsxWorkerResponse(value: unknown): XlsxWorkerResponse | null {
  if (value == null || typeof value !== "object") return null;
  const response = value as Partial<XlsxWorkerResponse>;
  if (response.type === "workbook") {
    return Array.isArray(response.sheets)
      ? ({
          type: "workbook",
          sheets: response.sheets,
        } satisfies XlsxWorkerResponse)
      : null;
  }
  if (response.type === "error") {
    return {
      type: "error",
      code: "parse_failed",
      message:
        typeof response.message === "string"
          ? response.message
          : "Failed to parse spreadsheet.",
    };
  }
  return null;
}

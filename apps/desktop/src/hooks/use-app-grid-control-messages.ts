import { useCallback } from "react";
import type { GridDescriptorRunOptions } from "../lib/descriptors";
import type { ViewerDocument } from "../types";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type GridControlMessageBody = Record<string, unknown> | null | undefined;
type OpenKetcherWithFragment = (
  title: string,
  text: string,
  source?: {
    kind: "grid-row";
    documentId: string;
    rowIndex: number;
    title: string;
    extension: string;
  },
  extension?: string,
) => void;

type UseAppGridControlMessagesOptions = {
  activeDocument: ViewerDocument | null;
  calculateGridDescriptors: (documentId: string, options?: GridDescriptorRunOptions) => void;
  documents: ViewerDocument[];
  openKetcherWithFragment: OpenKetcherWithFragment;
  openKetcherWithStructures: (paths: string[]) => void;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  updateDirtyGridDocument: (documentId: string, dirty: boolean) => void;
  writeClipboardText: (text: string) => Promise<void>;
  writeGridPerfMetric: (body: unknown) => void;
};

export function useAppGridControlMessages({
  activeDocument,
  calculateGridDescriptors,
  documents,
  openKetcherWithFragment,
  openKetcherWithStructures,
  pushErrorStatus,
  pushStatus,
  updateDirtyGridDocument,
  writeClipboardText,
  writeGridPerfMetric,
}: UseAppGridControlMessagesOptions) {
  const handleGridControlMessage = useCallback((body: GridControlMessageBody) => {
    if (body?.type === "openInKetcher") {
      const title = typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : "structure";
      const textBase64 = typeof body.textBase64 === "string" ? body.textBase64.trim() : "";
      const documentId = typeof body.documentId === "string" ? body.documentId : "";
      if (textBase64) {
        try {
          const bytes = Uint8Array.from(atob(textBase64), (char) => char.charCodeAt(0));
          const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          const rowIndex = Number(body.rowIndex);
          const extension = typeof body.extension === "string" && body.extension.trim()
            ? body.extension.trim().replace(/^\./u, "")
            : "sdf";
          openKetcherWithFragment(title, text, body.gridEdit === true && documentId && Number.isFinite(rowIndex)
            ? {
                kind: "grid-row",
                documentId,
                rowIndex,
                title,
                extension,
              }
            : undefined, extension);
        } catch (error) {
          pushStatus(`Open in Ketcher failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
        return true;
      }
      const targetDocument = (documentId
        ? documents.find((document) => document.id === documentId)
        : null) ?? activeDocument;
      const targetPath = typeof body.path === "string" && body.path.trim().length > 0
        ? body.path.trim()
        : targetDocument?.path;
      if (targetPath) {
        openKetcherWithStructures([targetPath]);
      }
      return true;
    }

    if (body?.type === "calculateGridDescriptors") {
      const documentId = typeof body.documentId === "string" && body.documentId.trim()
        ? body.documentId.trim()
        : activeDocument?.id;
      if (!documentId) {
        pushStatus("Grid descriptor target is not open.", "error");
        return true;
      }
      const rowIndexes = Array.isArray(body.rowIndexes)
        ? body.rowIndexes.map((index) => Number(index)).filter(Number.isFinite)
        : [];
      calculateGridDescriptors(documentId, rowIndexes.length ? { rowIndexes } : {});
      return true;
    }

    if (body?.type === "gridPerfMetric") {
      console.info("[Burrete grid perf]", JSON.stringify(body));
      writeGridPerfMetric(body);
      return true;
    }

    if (body?.type === "copyText") {
      const text = typeof body.text === "string" ? body.text : "";
      void writeClipboardText(text)
        .then(() => pushStatus("Copied grid text"))
        .catch((error) => pushErrorStatus(error, "Grid copy failed"));
      return true;
    }

    if (body?.type === "gridDirtyChanged") {
      const documentId = typeof body.documentId === "string" ? body.documentId : "";
      updateDirtyGridDocument(documentId, body.dirty === true);
      return true;
    }

    return false;
  }, [activeDocument, calculateGridDescriptors, documents, openKetcherWithFragment, openKetcherWithStructures, pushErrorStatus, pushStatus, updateDirtyGridDocument, writeClipboardText, writeGridPerfMetric]);

  return { handleGridControlMessage };
}

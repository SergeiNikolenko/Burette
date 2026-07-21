import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GridDescriptorRunOptions } from "../lib/descriptors";
import { isTauriRuntime } from "../lib/tauri";
import type { GridNativeMenuState } from "../lib/native-menu";
import { isReadOnlyViewerMessageSource } from "../lib/viewer-bridge";
import type { ViewerDocument } from "../types";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type GridControlMessageBody = Record<string, unknown> | null | undefined;
const MAX_NATIVE_MENU_SELECTED_COUNT = 10_000_000;
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
  updateGridMenuState: (documentId: string, state: GridNativeMenuState) => void;
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
  updateGridMenuState,
  writeClipboardText,
  writeGridPerfMetric,
}: UseAppGridControlMessagesOptions) {
  const handleGridControlMessage = useCallback((
    body: GridControlMessageBody,
    eventSource: MessageEventSource | null,
  ) => {
    const readOnlySource = isReadOnlyViewerMessageSource(eventSource);
    if (readOnlySource && body?.type === "openInKetcher" && body.gridEdit === true) return true;
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
      if (readOnlySource) return true;
      const documentId = typeof body.documentId === "string" ? body.documentId : "";
      if (documentId && body.dirty === true && isTauriRuntime()) {
        void invoke("grid_mark_virtual_edit", { request: { documentId } })
          .catch((error) => pushErrorStatus(error, "Grid edit tracking failed"));
      }
      updateDirtyGridDocument(documentId, body.dirty === true);
      return true;
    }

    if (body?.type === "gridMenuStateChanged") {
      if (readOnlySource) return true;
      const documentId = typeof body.documentId === "string" && body.documentId
        ? body.documentId
        : activeDocument?.id ?? "";
      if (!documentId) return true;
      const selectedCount = Number(body.selectedCount);
      const normalizedSelectedCount = Number.isFinite(selectedCount)
        ? Math.min(MAX_NATIVE_MENU_SELECTED_COUNT, Math.max(0, Math.trunc(selectedCount)))
        : 0;
      const selectedStructureCount = Number(body.selectedStructureCount);
      updateGridMenuState(documentId, {
        selectedCount: normalizedSelectedCount,
        selectedStructureCount: Number.isFinite(selectedStructureCount)
          ? Math.min(normalizedSelectedCount, Math.max(0, Math.trunc(selectedStructureCount)))
          : 0,
        dirty: body.dirty === true,
        canUndo: body.canUndo === true,
        canRedo: body.canRedo === true,
        undoLabel: typeof body.undoLabel === "string" && body.undoLabel.trim()
          ? body.undoLabel.trim().slice(0, 80)
          : null,
        redoLabel: typeof body.redoLabel === "string" && body.redoLabel.trim()
          ? body.redoLabel.trim().slice(0, 80)
          : null,
        editingText: body.editingText === true,
        viewMode: body.viewMode === "table" ? "table" : "cards",
        showProperties: body.showProperties === true,
        cardRenderer: body.cardRenderer === "xyzrender" ? "xyzrender" : "rdkit",
        hasMolecules: body.hasMolecules === true,
        saveEnabled: body.saveEnabled === true,
        exportEnabled: body.exportEnabled === true,
        selectionEnabled: body.selectionEnabled === true,
        canOpenSelectedInMolstar: body.canOpenSelectedInMolstar === true,
        canOpenSelectedInKetcher: body.canOpenSelectedInKetcher === true,
        canGenerate3dForSelection: body.canGenerate3dForSelection === true,
        supportsXyzrender: body.supportsXyzrender === true,
        generating3d: body.generating3d === true,
      });
      return true;
    }

    return false;
  }, [activeDocument, calculateGridDescriptors, documents, openKetcherWithFragment, openKetcherWithStructures, pushErrorStatus, pushStatus, updateDirtyGridDocument, updateGridMenuState, writeClipboardText, writeGridPerfMetric]);

  return { handleGridControlMessage };
}

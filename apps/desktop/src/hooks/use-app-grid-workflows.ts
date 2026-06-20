import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showNativeContextMenu } from "../components/native-context-menu";
import type { StatusKind } from "../components/types";
import {
  delimitedColumnChoiceLabel,
  isDelimitedColumnAmbiguity,
  summarizeErrors,
  type GridDelimitedColumnChoice,
} from "../lib/file-routing";
import type { StructureDragPayload } from "../lib/structure-drag";
import { isTauriRuntime } from "../lib/tauri";
import type { MoleculeTab } from "../stores/molecule-store";
import type { ViewerDocument } from "../types";

type PushStatus = (message: string, kind?: StatusKind, details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type GridAppendResult = {
  recordsAppended: number;
  totalRows: number;
  errors: string[];
};

type UseAppGridWorkflowsOptions = {
  activeDocument: ViewerDocument | null | undefined;
  documents: ViewerDocument[];
  notifyGridPoseReviewSelection: (targetDocumentId: string, activePose: number) => void;
  poseReviewSelections: Record<string, number>;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  setActiveTab: (id: string) => void;
  tabs: MoleculeTab[];
};

export function useAppGridWorkflows({
  activeDocument,
  documents,
  notifyGridPoseReviewSelection,
  poseReviewSelections,
  pushErrorStatus,
  pushStatus,
  setActiveTab,
  tabs,
}: UseAppGridWorkflowsOptions) {
  const pendingXyzrenderSheetDropRef = useRef<{ documentId: string; payload: StructureDragPayload } | null>(null);

  const postXyzrenderSheetItems = useCallback((documentId: string, payload: StructureDragPayload) => {
    const iframe = Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")).find(
      (item) => item.dataset.documentId === documentId,
    );
    if (!iframe?.contentWindow) return false;
    const iframeRect = iframe.getBoundingClientRect();
    const point = payload.point && Number.isFinite(payload.point.x) && Number.isFinite(payload.point.y)
      ? { x: payload.point.x - iframeRect.left, y: payload.point.y - iframeRect.top }
      : null;
    iframe.contentWindow.postMessage(
      {
        source: "burrete-host",
        body: {
          type: "addXyzrenderSheetItems",
          documentId,
          paths: payload.paths,
          records: payload.records,
          point,
        },
      },
      "*",
    );
    return true;
  }, []);

  const addXyzrenderSheetItemsToDocument = useCallback((targetDocumentId: string, payload: StructureDragPayload) => {
    const targetDocument = documents.find((document) => document.id === targetDocumentId);
    if (
      !targetDocument ||
      targetDocument.renderer !== "xyzrender-external" ||
      (payload.paths.length === 0 && payload.records.length === 0)
    ) return false;
    const posted = postXyzrenderSheetItems(targetDocument.id, payload);
    if (!posted) {
      pendingXyzrenderSheetDropRef.current = { documentId: targetDocument.id, payload };
      const tab = tabs.find((item) => item.location.kind === "file" && (
        item.location.documentId === targetDocument.id ||
        item.location.path === targetDocument.path
      ));
      if (tab) setActiveTab(tab.id);
    }
    const count = payload.paths.length + payload.records.length;
    pushStatus(`Adding ${count} structure${count === 1 ? "" : "s"} to xyzrender sheet`);
    return true;
  }, [documents, postXyzrenderSheetItems, pushStatus, setActiveTab, tabs]);

  const addXyzrenderSheetItems = useCallback((payload: StructureDragPayload) => {
    if (!activeDocument) return false;
    return addXyzrenderSheetItemsToDocument(activeDocument.id, payload);
  }, [activeDocument, addXyzrenderSheetItemsToDocument]);

  const notifyGridRecordsAppended = useCallback((targetDocumentId: string, result: GridAppendResult) => {
    const iframe = Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")).find(
      (item) => item.dataset.documentId === targetDocumentId,
    );
    iframe?.contentWindow?.postMessage({
      source: "burrete-grid-host",
      body: {
        type: "gridRecordsAppended",
        documentId: targetDocumentId,
        recordsAppended: result.recordsAppended,
        totalRows: result.totalRows,
      },
    }, "*");
  }, []);

  const appendDelimitedGridRecords = useCallback(
    async (targetDocument: ViewerDocument, path: string, smilesColumn: string) => {
      const result = await invoke<GridAppendResult>("grid_append_delimited_records", {
        request: {
          documentId: targetDocument.id,
          path,
          smilesColumn,
        },
      });
      notifyGridRecordsAppended(targetDocument.id, result);
      const message = `Appended ${result.recordsAppended} molecule${result.recordsAppended === 1 ? "" : "s"} to grid`;
      if (result.errors.length > 0) {
        pushStatus(`${message}. ${summarizeErrors(result.errors)}`, "error", result.errors);
      } else {
        pushStatus(message);
      }
    },
    [notifyGridRecordsAppended, pushStatus],
  );

  const showDelimitedGridColumnAppendMenu = useCallback(
    async (targetDocument: ViewerDocument, path: string) => {
      const choices = await invoke<GridDelimitedColumnChoice[]>("grid_delimited_columns", {
        request: { path },
      });
      if (choices.length === 0) {
        pushStatus("No structure columns were found in the delimited file", "error");
        return;
      }
      pushStatus("Choose a structure column to append to the grid");
      await showNativeContextMenu(
        choices.map((choice) => ({
          kind: "item" as const,
          id: `delimited-column-append-${choice.index}`,
          text: delimitedColumnChoiceLabel(choice),
          action: () => {
            void appendDelimitedGridRecords(targetDocument, path, String(choice.index))
              .catch((error) => pushErrorStatus(error, "Grid append failed"));
          },
        })),
      );
    },
    [appendDelimitedGridRecords, pushErrorStatus, pushStatus],
  );

  const appendGridRecords = useCallback((targetDocumentId: string, payload: StructureDragPayload) => {
    if (payload.paths.length === 0 && payload.records.length === 0) return false;
    const targetDocument = documents.find((document) => document.id === targetDocumentId);
    if (!targetDocument || targetDocument.renderer !== "grid2d") return false;
    if (!isTauriRuntime()) return false;
    void (async () => {
      try {
        const result = await invoke<GridAppendResult>("grid_append_records", {
          request: {
            documentId: targetDocument.id,
            paths: payload.paths,
            records: payload.records,
          },
        });
        notifyGridRecordsAppended(targetDocument.id, result);
        const message = `Appended ${result.recordsAppended} molecule${result.recordsAppended === 1 ? "" : "s"} to grid`;
        if (result.errors.length > 0) {
          pushStatus(`${message}. ${summarizeErrors(result.errors)}`, "error", result.errors);
        } else {
          pushStatus(message);
        }
      } catch (error) {
        if (payload.paths.length === 1 && payload.records.length === 0 && isDelimitedColumnAmbiguity(error)) {
          void showDelimitedGridColumnAppendMenu(targetDocument, payload.paths[0])
            .catch((menuError) => pushErrorStatus(menuError, "Structure column menu failed"));
          return;
        }
        pushErrorStatus(error, "Grid append failed");
      }
    })();
    return true;
  }, [documents, notifyGridRecordsAppended, pushErrorStatus, pushStatus, showDelimitedGridColumnAppendMenu]);

  useEffect(() => {
    const pending = pendingXyzrenderSheetDropRef.current;
    if (!pending || activeDocument?.id !== pending.documentId) return;
    if (postXyzrenderSheetItems(pending.documentId, pending.payload)) {
      pendingXyzrenderSheetDropRef.current = null;
    }
  }, [activeDocument?.id, postXyzrenderSheetItems]);

  useEffect(() => {
    if (!activeDocument || activeDocument.renderer !== "grid2d") return;
    const activePose = poseReviewSelections[activeDocument.id];
    if (!Number.isFinite(activePose)) return;
    notifyGridPoseReviewSelection(activeDocument.id, activePose);
  }, [activeDocument, notifyGridPoseReviewSelection, poseReviewSelections]);

  return {
    addXyzrenderSheetItems,
    addXyzrenderSheetItemsToDocument,
    appendGridRecords,
  };
}

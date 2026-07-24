import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showNativeContextMenu } from "../components/native-context-menu";
import type { StatusKind } from "../components/types";
import { parseBrowserDevDelimitedGridRecords, type GridRecord } from "../lib/browser-dev-documents";
import {
  delimitedColumnChoiceLabel,
  isDelimitedColumnAmbiguity,
  summarizeErrors,
  type GridDelimitedColumnChoice,
} from "../lib/file-routing";
import type { StructureDragPayload } from "../lib/structure-drag";
import { isTauriRuntime } from "../lib/tauri";
import { activeViewerIframeForDocument } from "../lib/viewer-bridge";
import { runWindowMutation } from "../lib/window-mutation-barrier";
import type { MoleculeTab } from "../stores/molecule-store";
import type { ViewerDocument } from "../types";

type PushStatus = (message: string, kind?: StatusKind, details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type GridAppendResult = {
  recordsAppended: number;
  totalRows: number;
  errors: string[];
};

type BrowserGridAppend = {
  documentId: string;
  payload: StructureDragPayload;
  rows?: GridRecord[];
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
  updateDirtyGridDocument: (documentId: string, dirty: boolean) => void;
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
  updateDirtyGridDocument,
}: UseAppGridWorkflowsOptions) {
  const pendingXyzrenderSheetDropRef = useRef<{ documentId: string; payload: StructureDragPayload } | null>(null);
  const pendingBrowserGridAppendRef = useRef<BrowserGridAppend[]>([]);
  const readyBrowserGridFramesRef = useRef<Map<string, Window>>(new Map());

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
        source: "burette-host",
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
    const iframe = activeViewerIframeForDocument(targetDocumentId, "grid2d");
    iframe?.contentWindow?.postMessage({
      source: "burette-grid-host",
      body: {
        type: "gridRecordsAppended",
        documentId: targetDocumentId,
        recordsAppended: result.recordsAppended,
        totalRows: result.totalRows,
      },
    }, "*");
  }, []);

  const postBrowserGridAppend = useCallback((targetDocumentId: string, payload: StructureDragPayload, rows?: GridRecord[]) => {
    const iframe = Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")).find(
      (item) => item.dataset.documentId === targetDocumentId,
    );
    if (!iframe?.contentWindow || readyBrowserGridFramesRef.current.get(targetDocumentId) !== iframe.contentWindow) return false;
    iframe.contentWindow.postMessage({
      source: "burette-grid-host",
      body: {
        type: "gridAppendRecords",
        documentId: targetDocumentId,
        paths: payload.paths,
        records: payload.records,
        ...(rows?.length ? { rows } : {}),
      },
    }, "*");
    return true;
  }, []);

  const flushPendingBrowserGridAppend = useCallback((documentId: string) => {
    pendingBrowserGridAppendRef.current = pendingBrowserGridAppendRef.current.filter((pending) => (
      pending.documentId !== documentId || !postBrowserGridAppend(pending.documentId, pending.payload, pending.rows)
    ));
  }, [postBrowserGridAppend]);

  const appendDelimitedGridRecords = useCallback(
    (targetDocument: ViewerDocument, path: string, smilesColumn: string) => runWindowMutation(targetDocument.id, async () => {
      const result = await invoke<GridAppendResult>("grid_append_delimited_records", {
        request: {
          documentId: targetDocument.id,
          path,
          smilesColumn,
        },
      });
      if (result.recordsAppended > 0) updateDirtyGridDocument(targetDocument.id, true);
      notifyGridRecordsAppended(targetDocument.id, result);
      const message = `Appended ${result.recordsAppended} molecule${result.recordsAppended === 1 ? "" : "s"} to grid`;
      if (result.errors.length > 0) {
        pushStatus(`${message}. ${summarizeErrors(result.errors)}`, "error", result.errors);
      } else {
        pushStatus(message);
      }
    }),
    [notifyGridRecordsAppended, pushStatus, updateDirtyGridDocument],
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
    if (!isTauriRuntime()) {
      const targetExtension = targetDocument.extension.toLowerCase();
      if ((targetExtension === "csv" || targetExtension === "tsv") && payload.records.length === 0) {
        return false;
      }
      const parsedDelimitedRecords = targetExtension === "csv" || targetExtension === "tsv"
        ? payload.records.map((record) => ({
          record,
          rows: record.inputExtension.toLowerCase().replace(/^\./u, "") === targetExtension
            ? parseBrowserDevDelimitedGridRecords(record.text, targetExtension)
            : [],
        }))
        : [];
      const rows = parsedDelimitedRecords.flatMap((parsed) => parsed.rows);
      const browserPayload = rows.length
        ? {
          ...payload,
          records: parsedDelimitedRecords.flatMap((parsed) => parsed.rows.length ? [] : [parsed.record]),
        }
        : payload;
      if (!postBrowserGridAppend(targetDocument.id, browserPayload, rows)) {
        pendingBrowserGridAppendRef.current.push({ documentId: targetDocument.id, payload: browserPayload, rows });
        const tab = tabs.find((item) => item.location.kind === "file" && (
          item.location.documentId === targetDocument.id || item.location.path === targetDocument.path
        ));
        if (tab) setActiveTab(tab.id);
      }
      const count = payload.paths.length + payload.records.length;
      pushStatus(`Adding ${count} molecule source${count === 1 ? "" : "s"} to grid`);
      return true;
    }
    void runWindowMutation(targetDocument.id, async () => {
      try {
        const result = await invoke<GridAppendResult>("grid_append_records", {
          request: {
            documentId: targetDocument.id,
            paths: payload.paths,
            records: payload.records,
          },
        });
        if (result.recordsAppended > 0) updateDirtyGridDocument(targetDocument.id, true);
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
    }).catch((error) => pushErrorStatus(error, "Grid append paused"));
    return true;
  }, [documents, notifyGridRecordsAppended, postBrowserGridAppend, pushErrorStatus, pushStatus, setActiveTab, showDelimitedGridColumnAppendMenu, tabs, updateDirtyGridDocument]);

  useEffect(() => {
    const pending = pendingXyzrenderSheetDropRef.current;
    if (!pending || activeDocument?.id !== pending.documentId) return;
    if (postXyzrenderSheetItems(pending.documentId, pending.payload)) {
      pendingXyzrenderSheetDropRef.current = null;
    }
  }, [activeDocument?.id, postXyzrenderSheetItems]);

  useEffect(() => {
    if (activeDocument) flushPendingBrowserGridAppend(activeDocument.id);
  }, [activeDocument?.id, flushPendingBrowserGridAppend]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data && typeof event.data === "object" ? event.data as {
        source?: unknown;
        body?: { type?: unknown; documentId?: unknown };
      } : null;
      if (data?.source !== "burette-grid" || data.body?.type !== "ready" || typeof data.body.documentId !== "string") return;
      const iframe = Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")).find(
        (item) => item.dataset.documentId === data.body?.documentId,
      );
      if (!iframe?.contentWindow || iframe.contentWindow !== event.source) return;
      readyBrowserGridFramesRef.current.set(data.body.documentId, iframe.contentWindow);
      flushPendingBrowserGridAppend(data.body.documentId);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [flushPendingBrowserGridAppend]);

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

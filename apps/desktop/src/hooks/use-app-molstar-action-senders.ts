import { useCallback } from "react";

import type { StructureViewerAction } from "../components/types";
import type { TextStructureSelection } from "../lib/text-structure-selection";
import type { TextFileDocument, ViewerDocument } from "../types";

type ActiveViewerIframeForDocument = (documentId: string) => HTMLIFrameElement | null;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;

type UseAppMolstarActionSendersOptions = {
  activeDocument: ViewerDocument | null;
  activeViewerIframeForDocument: ActiveViewerIframeForDocument;
  documents: ViewerDocument[];
  pushStatus: PushStatus;
};

export function useAppMolstarActionSenders({
  activeDocument,
  activeViewerIframeForDocument,
  documents,
  pushStatus,
}: UseAppMolstarActionSendersOptions) {
  const selectTextStructure = useCallback((textDocument: TextFileDocument, selection: TextStructureSelection) => {
    const targetDocument = documents.find((document) => document.path === textDocument.path) ??
      (activeDocument?.path === textDocument.path ? activeDocument : null);
    if (!targetDocument || targetDocument.renderer !== "molstar") return;
    const iframe = activeViewerIframeForDocument(targetDocument.id);
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({
      source: "burrete-agent-host",
      body: {
        type: "agent-action",
        id: `text-selection-${Date.now()}`,
        action: {
          type: "select_residues",
          label: selection.label,
          selector: selection.selector,
          granularity: selection.granularity,
          mode: "replace",
        },
      },
    }, "*");
  }, [activeDocument, activeViewerIframeForDocument, documents]);

  const runStructureViewerAction = useCallback((document: ViewerDocument, action: StructureViewerAction) => {
    if (document.renderer !== "molstar") {
      pushStatus(`${action.label} needs a Mol* viewer`, "error");
      return;
    }
    const iframe = activeViewerIframeForDocument(document.id);
    if (!iframe?.contentWindow) {
      pushStatus(`Open ${document.title} in the main viewer first`, "error");
      return;
    }
    iframe.contentWindow.postMessage({
      source: "burrete-agent-host",
      body: {
        type: "agent-action",
        id: `structure-action-${Date.now()}`,
        action,
      },
    }, "*");
    if (!("notify" in action) || action.notify !== false) {
      pushStatus(action.label);
    }
  }, [activeViewerIframeForDocument, pushStatus]);

  return { runStructureViewerAction, selectTextStructure };
}

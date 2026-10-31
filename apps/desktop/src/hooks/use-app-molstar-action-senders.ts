import { useCallback } from "react";

import type { StructureViewerAction, StructureViewerActionOptions } from "../components/types";
import type { TextStructureSelection } from "../lib/text-structure-selection";
import { requestViewerAction } from "../lib/viewer-bridge";
import type { ActiveViewerIframeForDocument } from "../lib/viewer-bridge";
import type { TextFileDocument, ViewerDocument } from "../types";

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
  const selectTextStructure = useCallback((textDocument: TextFileDocument, selection: TextStructureSelection | null) => {
    // A rendered document can also have an interactive copy in a dock. Resolve
    // the actual interactive frame, not the main document's chosen renderer.
    const candidates = [activeDocument, ...documents].filter((document) => document?.path === textDocument.path);
    // A collection drawn as cards marks the record's atoms on its card.
    const grid = candidates.map(document => document && activeViewerIframeForDocument(document.id, "grid2d")).find(Boolean);
    const atomIndex = selection?.granularity === "atom" ? selection.selector.atom_index : undefined;
    grid?.contentWindow?.postMessage({
      source: "burette-grid-host",
      body: {
        type: "gridSourceAtomSelection",
        record: selection?.record ?? 0,
        atoms: atomIndex === undefined ? [] : [atomIndex].flat(),
      },
    }, "*");
    // Mol* keeps its selection on a collapsed caret and shows the first record's atoms.
    if (!selection || (selection.record ?? 0) > 0) return;
    const iframe = candidates.map(document => document && activeViewerIframeForDocument(document.id, "molstar")).find(Boolean);
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({
      source: "burette-agent-host",
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

  const runStructureViewerAction = useCallback((document: ViewerDocument, action: StructureViewerAction, options?: StructureViewerActionOptions) => {
    if (action.type === "show_scalar_field" || action.type === "scalar_field_binding" || action.type === "scalar_field_validate" || action.type === "geometry_binding" || action.type === "update_geometry") return requestViewerAction(document.id, action, 15000, options?.signal, { target: options?.target });
    // A collection shows its molecules as cards: a composition row selects and
    // reveals the card rather than asking for a structure viewer.
    if (document.renderer === "grid2d" && (action.type === "set_sdf_molecule" || action.type === "clear_selection")) {
      const index = action.type === "set_sdf_molecule" ? action.index : null;
      activeViewerIframeForDocument(document.id, "grid2d")?.contentWindow?.postMessage({
        source: "burette-grid-host",
        body: {
          type: "chemicalSpaceSelectionChanged",
          documentId: document.id,
          sourceRecordIds: index === null ? [] : [index],
          filterToSelection: false,
          focusSourceRecordId: index,
        },
      }, "*");
      return;
    }
    if (document.renderer !== "molstar") {
      pushStatus(`${action.label} needs a 3D view`, "error");
      return;
    }
    const iframe = activeViewerIframeForDocument(document.id);
    if (!iframe?.contentWindow) {
      if (action.type === "preview_geometry") return;
      pushStatus(`Open ${document.title} in the main viewer first`, "error");
      return;
    }
    // The removed inspector row loses focus. Keep Undo with the scene edit
    // instead of falling through to an unrelated workspace layout change.
    if (action.type === "remove_components") iframe.focus();
    if (action.type === "open_components_menu") {
      const rect = iframe.getBoundingClientRect();
      action = { ...action, x: action.x - rect.left, y: action.y - rect.top };
      iframe.focus();
    }
    iframe.contentWindow.postMessage({
      source: "burette-agent-host",
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

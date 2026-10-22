import type { ShellActions, ShellViewState } from "../types";
import type { DockArea, DockTabKind } from "../../lib/dock";
import type { Location } from "../editor-area/page-kinds";
import { useMoleculeStore, type TabPane } from "../../stores/molecule-store";
import { openScreen } from "./pane-actions";

export function dockScreenLocation(area: DockArea, kind: DockTabKind, state: ShellViewState): Location | null {
  const id = area === "right" ? state.rightDockDocumentId : state.bottomDockDocumentId;
  const source = id ? state.documents.find(document => document.id === id) : state.activeDocument;
  const text = id ? state.textDocuments.find(document => document.id === id) : null;
  if (kind === "jobs") return { kind: "jobs" };
  if (kind === "chemical-space") return source ? { kind: "chemical-space", collectionPath: source.path } : null;
  if (kind === "files") {
    if ((area === "right" ? state.rightDockTool : state.bottomDockTool) === "ketcher") return { kind: "ketcher" };
    if (source) return { kind: "file", path: source.path, documentId: source.id };
    if (text) return { kind: "text-file", path: text.path, documentId: text.id };
    return null;
  }
  return { kind: "tool", tool: kind, area, ...(source ? { sourcePath: source.path } : {}) };
}

export function openDockScreen(area: DockArea, kind: DockTabKind, state: ShellViewState, actions: ShellActions, pane: TabPane | null = null) {
  const location = dockScreenLocation(area, kind, state);
  if (!location) return;
  // Capture the previous tool owner before changing focus.
  actions.setDockOpen(area, false);
  openScreen(location, pane);
  return useMoleculeStore.getState().activeTabId;
}

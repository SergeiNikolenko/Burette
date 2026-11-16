import React from "react";
import type { ShellViewState } from "../apps/desktop/src/components/types";
import { doc, resetSource, shellActions, useFixtureRender, createHost } from "./structure-edit-fixture";

export async function dockFixture() {
  const { DockPanel } = await import("../apps/desktop/src/components/dock-panel");
  const { useTabWorkspaceStore } = await import("../apps/desktop/src/stores/tab-workspace-store");
  const other = { ...doc, id: "dock-metadata", path: "/dock-metadata.sdf" };
  const tabId = "dock-metadata-workspace";
  const store = useTabWorkspaceStore.getState();
  store.openDockTab(tabId, "right", "structure-edit");
  store.openDockTab(tabId, "right", "text");
  store.setDockActiveTab(tabId, "right", "structure-edit");
  resetSource();
  const { host, root } = createHost();
  function Dock() {
    useFixtureRender();
    const dock = useTabWorkspaceStore(state => state.workspaces[tabId].right);
    const state: Partial<ShellViewState> = { page: "viewer", documents: [other], textDocuments: [], activeDocument: other,
      activeTab: { id: tabId, location: { kind: "document", path: other.path }, back: [], forward: [] },
      rightDockTabs: dock.tabs, rightDockActiveTab: dock.activeTab, rightDockOpen: true,
      rightDockDocumentId: other.id, rightDockTool: null, dockDroppedStructures: [], hoveredGridRows: {}, visibleDocuments: [other] };
    return <DockPanel area="right" state={state as ShellViewState} actions={shellActions({ setStructureDragActive() {}, runStructureViewerAction: async () => {},
      setDockActiveTab: (area, kind) => useTabWorkspaceStore.getState().setDockActiveTab(tabId, area, kind) })} />;
  }
  return { host, root, Dock, tabId, useTabWorkspaceStore };
}

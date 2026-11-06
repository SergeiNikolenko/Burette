import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";
const browser = new Window();
for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event", "CustomEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { useTabWorkspaceStore, getTabWorkspaceStoreSnapshot, WINDOW_TOOLS_ID } = await import("../apps/desktop/src/stores/tab-workspace-store");
const { useDockLayout } = await import("../apps/desktop/src/hooks/use-dock-layout");
const { useWorkspacePanesStore } = await import("../apps/desktop/src/stores/workspace-panes-store");
const { migrateLegacyRightPanels, openRightTool } = await import("../apps/desktop/src/lib/right-workspace-panel");
const { chemicalSpaceKind } = await import("../apps/desktop/src/components/editor-area/page-kinds/chemical-space");
const collection = (id: string, path = "/collection.sdf") => ({ id, path, title: path, extension: "sdf", renderer: "grid2d" }) as ViewerDocument;

test("a pinned analysis never substitutes another collection", () => {
  const other = collection("other", "/other.sdf");
  const props = { tabId: "analysis", state: { documents: [other], activeDocument: other } as ShellViewState, actions: {} as ShellActions, isActive: true };
  const component = chemicalSpaceKind.Component as (props: typeof props & { location: { kind: "chemical-space"; collectionPath?: string } }) => React.ReactElement<any>;
  const pinned = component({ ...props, location: { kind: "chemical-space", collectionPath: "/missing.sdf" } });
  const follow = component({ ...props, location: { kind: "chemical-space" } });
  expect(pinned.props.children.props.children.props.document).toBeNull();
  expect(follow.props.children.props.children.props.document).toBe(other);
});

test("legacy right pins migrate into one group and resolve new runtime IDs by path", async () => {
  useMoleculeStore.setState({
    tabs: [{ id: "owner", location: { kind: "launcher" }, back: [], forward: [] }],
    activeTabId: "owner", documents: [collection("old")], textDocuments: [],
  });
  useWorkspacePanesStore.setState({ selectedTabs: {}, closedGroups: {}, fullViewTabId: null });
  useTabWorkspaceStore.setState({ workspaces: {} });
  useTabWorkspaceStore.getState().setDockDocument("owner", "right", "old");
  const snapshot = getTabWorkspaceStoreSnapshot();
  expect(snapshot.workspaces.owner.right.documentId).toBeNull();
  expect(snapshot.workspaces.owner.right.documentPath).toBe("/collection.sdf");
  useTabWorkspaceStore.getState().restoreSnapshot(snapshot);
  const host = document.createElement("div");
  const root = createRoot(host);
  let binding: string | null = null;
  function Probe() { binding = useDockLayout(useMoleculeStore(state => state.activeTabId)).rightDockDocumentId; return null; }
  await act(async () => { useMoleculeStore.setState({ documents: [collection("new")] }); root.render(<Probe />); });
  expect(binding).toBe("new");
  const migratedTabs = useMoleculeStore.getState().tabs.filter(tab => tab.pane === "right");
  expect(migratedTabs.map(tab => tab.location)).toEqual([
    { kind: "tool", area: "right", tool: "inspector", sourcePath: "/collection.sdf" },
    { kind: "tool", area: "right", tool: "text", sourcePath: "/collection.sdf" },
    { kind: "file", path: "/collection.sdf", documentId: "new" },
  ]);
  expect(useTabWorkspaceStore.getState().workspaces.owner.right.open).toBe(false);
  await act(async () => migrateLegacyRightPanels());
  expect(useMoleculeStore.getState().tabs.filter(tab => tab.pane === "right")).toEqual(migratedTabs);
  await act(async () => { useMoleculeStore.setState({ documents: [collection("other", "/other.sdf")] }); });
  expect(binding).toBe("missing:/collection.sdf");
  await act(async () => { openRightTool("inspector", "/collection.sdf"); });
  expect(binding).toBe("missing:/collection.sdf");
  await act(async () => { openRightTool("inspector"); });
  expect(binding).toBeNull();
  expect(useMoleculeStore.getState().tabs.filter(tab => tab.pane === "right")).toHaveLength(4);
  await act(async () => root.unmount());
});


test("bottom tools persist across source focus and closure", async () => {
  useTabWorkspaceStore.setState({ workspaces: {} });
  useMoleculeStore.setState({ tabs: [{ id: "source-a", location: { kind: "jobs" }, back: [], forward: [] }], activeTabId: "source-a" });
  let layout: ReturnType<typeof useDockLayout>;
  function Probe() { layout = useDockLayout(useMoleculeStore(state => state.activeTabId)); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
  await act(async () => { layout.openDockTab("bottom", "logs"); });
  const { setAgentWorkspacePanel } = await import("../apps/desktop/src/lib/agent-workspace-panel");
  await act(async () => { setAgentWorkspacePanel({ area: "bottom", open: false }, "source-a", useMoleculeStore.getState().tabs); });
  expect(layout.bottomDockOpen).toBe(false);
  await act(async () => { setAgentWorkspacePanel({ area: "bottom", open: true }, "source-a", useMoleculeStore.getState().tabs); });
  await act(async () => { useMoleculeStore.getState().openNewTab(); });
  expect([layout.bottomDockOpen, layout.bottomDockActiveTab]).toEqual([true, "logs"]);
  await act(async () => { useMoleculeStore.getState().closeTab("source-a"); });
  expect(useTabWorkspaceStore.getState().workspaces[WINDOW_TOOLS_ID].bottom.activeTab).toBe("logs");
  await act(async () => root.unmount());
});

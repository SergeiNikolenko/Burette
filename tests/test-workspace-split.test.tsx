import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellViewState, ShellActions } from "../apps/desktop/src/components/types";
const browser = new Window();
for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "CSS"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
mock.module("../apps/desktop/src/components/editor-area/editor-tabs", () => ({ EditorTabs: () => null }));
mock.module("../apps/desktop/src/components/editor-area/tab-history-pages", () => ({ TabHistoryPages: ({ tab }: any) => <iframe title={tab.id} className="viewer-iframe" data-document-id={tab.location.documentId} /> }));
const { createRoot } = await import("react-dom/client");
const { ViewerArea } = await import("../apps/desktop/src/components/editor-area");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { useWorkspacePanesStore } = await import("../apps/desktop/src/stores/workspace-panes-store");
const { activeViewerIframeForDocument } = await import("../apps/desktop/src/lib/viewer-bridge");

test("split, focus, full view and return retain the same mounted views", async () => {
  const tabs = ["a", "b", "c"].map(id => ({ id, location: { kind: "file" as const, documentId: "shared", path: "/scene.pdb" }, back: [], forward: [] }));
  useMoleculeStore.setState({ tabs, activeTabId: "a", documents: [], textDocuments: [] });
  useWorkspacePanesStore.setState({ selectedTabs: {}, fullViewTabId: null });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  function Workspace() {
    const model = useMoleculeStore();
    const state = { ...model, page: "viewer", dirtyGridDocuments: new Set(), activeTab: model.tabs.find(tab => tab.id === model.activeTabId) } as unknown as ShellViewState;
    return <ViewerArea state={state} actions={{ selectTab: model.setActiveTab } as ShellActions} />;
  }
  await act(async () => root.render(<Workspace />));
  const a = host.querySelector('iframe[title="a"]');
  await act(async () => useMoleculeStore.getState().placeTab("b", "right"));
  const b = host.querySelector('iframe[title="b"]');
  expect(a).not.toBeNull(); expect(b).not.toBeNull();
  expect(host.querySelectorAll('[data-workspace-visible]').length).toBe(2);
  expect(activeViewerIframeForDocument("shared")).toBe(b);
  await act(async () => useMoleculeStore.getState().setActiveTab("a"));
  expect(activeViewerIframeForDocument("shared")).toBe(a);
  await act(async () => useMoleculeStore.getState().placeTab("c", "bottom"));
  expect(host.querySelectorAll('[data-workspace-visible]').length).toBe(3);
  await act(async () => { useMoleculeStore.getState().setActiveTab("b"); useWorkspacePanesStore.getState().setFullView("b"); });
  expect(host.querySelectorAll('[data-workspace-visible]').length).toBe(1);
  expect(host.querySelector('[data-full-view] iframe')).toBe(b);
  await act(async () => useWorkspacePanesStore.getState().setFullView(null));
  expect(host.querySelectorAll('[data-workspace-visible]').length).toBe(3);
  expect(host.querySelector('iframe[title="a"]')).toBe(a);
  expect(host.querySelector('iframe[title="b"]')).toBe(b);
  await act(async () => useMoleculeStore.getState().placeTab("b", null));
  expect(host.querySelector('iframe[title="b"]')).toBe(b);
  await act(async () => root.unmount()); host.remove();
});

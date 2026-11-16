import { expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellViewState, ShellActions } from "../apps/desktop/src/components/types";
import type { MoleculeTab } from "../apps/desktop/src/stores/molecule-store";
const browser = new Window();
for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "CSS"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
mock.module("../apps/desktop/src/components/editor-area/editor-tabs", () => ({ EditorTabs: () => null }));
mock.module("../apps/desktop/src/components/editor-area/tab-history-pages", () => ({ TabHistoryPages: ({ tab }: any) => <iframe title={tab.id} className="viewer-iframe" data-document-id={tab.location.documentId} /> }));
const { createRoot } = await import("react-dom/client");
const { ViewerArea } = await import("../apps/desktop/src/components/editor-area");
const { FullViewExitButton } = await import("../apps/desktop/src/components/workspace-panes/full-view-exit");
const { WorkspaceSplitLayout } = await import("../apps/desktop/src/components/workspace-panes/workspace-split-layout");
const { usePaneVisibility } = await import("../apps/desktop/src/components/workspace-panes/use-pane-tabs");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { useWorkspacePanesStore } = await import("../apps/desktop/src/stores/workspace-panes-store");
const { toggleWorkspacePanel } = await import("../apps/desktop/src/lib/workspace-panel-toggle");
const { openRightTool } = await import("../apps/desktop/src/lib/right-workspace-panel");
const { activeViewerIframeForDocument } = await import("../apps/desktop/src/lib/viewer-bridge");

test("split, focus, full view and return retain the same mounted views", async () => {
  const tabs = ["a", "b", "c"].map(id => ({ id, location: { kind: "file" as const, documentId: "shared", path: "/scene.pdb" }, back: [], forward: [] }));
  useMoleculeStore.setState({ tabs, activeTabId: "a", documents: [], textDocuments: [] });
  useWorkspacePanesStore.setState({ selectedTabs: {}, closedGroups: {}, fullViewTabId: null });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  function Workspace() {
    const model = useMoleculeStore();
    const state = { ...model, page: "viewer", dirtyGridDocuments: new Set(), activeTab: model.tabs.find(tab => tab.id === model.activeTabId) } as unknown as ShellViewState;
    return <>
      <header><FullViewExitButton /></header>
      <ViewerArea state={state} actions={{ selectTab: model.setActiveTab } as ShellActions} />
    </>;
  }
  await act(async () => root.render(<Workspace />));
  const a = host.querySelector('iframe[title="a"]');
  await act(async () => useMoleculeStore.getState().placeTab("b", "right"));
  const b = host.querySelector('iframe[title="b"]');
  expect(a).not.toBeNull(); expect(b).not.toBeNull();
  expect(host.querySelectorAll('[data-workspace-visible]').length).toBe(2);
  expect(activeViewerIframeForDocument("shared")).toBe(b);
  await act(async () => useMoleculeStore.getState().moveTab("b", 0));
  expect(useMoleculeStore.getState().tabs[0].id).toBe("b");
  expect(Array.from(host.querySelectorAll("iframe")).slice(0, 2)).toEqual([a, b]);
  await act(async () => useMoleculeStore.getState().setActiveTab("a"));
  expect(activeViewerIframeForDocument("shared")).toBe(a);
  await act(async () => { useMoleculeStore.getState().setActiveTab("b"); toggleWorkspacePanel("right"); });
  expect(useMoleculeStore.getState().activeTabId).toBe("a");
  expect(host.querySelector('[data-split-right]')).toBeNull();
  expect(host.querySelectorAll('[data-workspace-visible]').length).toBe(1);
  expect(host.querySelector('iframe[title="b"]')).toBe(b);
  await act(async () => toggleWorkspacePanel("right"));
  expect(useWorkspacePanesStore.getState().selectedTabs.right).toBe("b");
  expect(host.querySelector('[data-split-right]')).not.toBeNull();
  const rightHeader = host.querySelector('.workspace-group-header[data-group="right"]');
  await act(async () => openRightTool("inspector", "/scene.pdb"));
  expect(host.querySelectorAll('.workspace-group-header[data-group="right"]')).toHaveLength(1);
  expect(host.querySelector('.workspace-group-header[data-group="right"]')).toBe(rightHeader);
  await act(async () => useMoleculeStore.getState().setActiveTab("b"));
  expect(host.querySelector('iframe[title="b"]')).toBe(b);
  await act(async () => useMoleculeStore.getState().placeTab("c", "bottom"));
  expect(host.querySelectorAll('[data-workspace-visible]').length).toBe(3);
  await act(async () => { useMoleculeStore.getState().setActiveTab("b"); useWorkspacePanesStore.getState().setFullView("b"); });
  expect(host.querySelectorAll('[data-workspace-visible]').length).toBe(1);
  expect(host.querySelector('[data-full-view] iframe')).toBe(b);
  const exitFullView = host.querySelector<HTMLButtonElement>('header > button[aria-label="Exit Full View"]');
  expect(exitFullView).not.toBeNull();
  expect(host.querySelector('.page-stack [aria-label="Exit Full View"]')).toBeNull();
  await act(async () => exitFullView!.click());
  expect(host.querySelector('[aria-label="Exit Full View"]')).toBeNull();
  expect(host.querySelectorAll('[data-workspace-visible]').length).toBe(3);
  expect(host.querySelector('iframe[title="a"]')).toBe(a);
  expect(host.querySelector('iframe[title="b"]')).toBe(b);
  await act(async () => useMoleculeStore.getState().placeTab("b", null));
  expect(host.querySelector('iframe[title="b"]')).toBe(b);
  await act(async () => root.unmount()); host.remove();
});

test("a burst of split resize input updates only the next frame and commits the final position", async () => {
  useWorkspacePanesStore.setState({ fullViewTabId: null, split: { right: 0.5, bottom: 0.5 } });
  const tabs = [{ id: "split", pane: "right" as const, location: { kind: "launcher" as const }, back: [], forward: [] }];
  const host = document.createElement("main");
  host.className = "app-shell";
  document.body.append(host);
  const root = createRoot(host);
  const pending = new Map<number, FrameRequestCallback>();
  let serial = 0;
  const request = spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
    pending.set(++serial, callback);
    return serial;
  });
  const cancel = spyOn(window, "cancelAnimationFrame").mockImplementation(id => { pending.delete(id); });
  const pointer = (type: string, x: number) => new browser.PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, button: 0 });
  try {
    await act(async () => root.render(<><header className="topbar" /><div className="drag-region" />
      <WorkspaceSplitLayout tabs={tabs} state={{ page: "viewer" } as ShellViewState} actions={{} as ShellActions}>
        <section className="page-surface" />
      </WorkspaceSplitLayout></>));
    const stack = host.querySelector<HTMLElement>(".page-stack")!;
    const handle = host.querySelector<HTMLElement>('[role="separator"]')!;
    const topbar = host.querySelector<HTMLElement>(".topbar")!;
    stack.getBoundingClientRect = () => new browser.DOMRect(0, 0, 1000, 800);
    await act(async () => {
      handle.dispatchEvent(pointer("pointerdown", 500));
      for (let x = 501; x <= 600; x++) handle.dispatchEvent(pointer("pointermove", x));
    });
    expect(stack.style.getPropertyValue("--split-right")).toBe("50%");
    expect(pending.size).toBe(1);
    const [frame] = pending.values();
    pending.clear();
    await act(async () => frame(16));
    expect(stack.style.getPropertyValue("--split-right")).toBe("60%");
    expect(topbar.style.getPropertyValue("--workspace-side-width")).toBe("400px");
    expect(host.style.getPropertyValue("--workspace-side-width")).toBe("");
    expect(useWorkspacePanesStore.getState().split.right).toBe(0.5);
    await act(async () => {
      handle.dispatchEvent(pointer("pointermove", 700));
      handle.dispatchEvent(pointer("pointerup", 700));
    });
    expect(stack.style.getPropertyValue("--split-right")).toBe("70%");
    expect(Number.parseFloat(topbar.style.getPropertyValue("--workspace-side-width"))).toBeCloseTo(300);
    expect(useWorkspacePanesStore.getState().split.right).toBe(0.7);
    expect(pending.size).toBe(0);
    await act(async () => {
      handle.dispatchEvent(pointer("pointerdown", 700));
      handle.dispatchEvent(pointer("pointermove", 650));
      handle.dispatchEvent(pointer("pointercancel", 650));
    });
    expect(useWorkspacePanesStore.getState().split.right).toBe(0.65);
    expect(pending.size).toBe(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    request.mockRestore();
    cancel.mockRestore();
  }
});

test("selecting a tab resolves visibility in linear work across a large workspace", async () => {
  const panes = [undefined, "right", "bottom", "floating"] as const;
  let examined = 0;
  const tabs = Array.from({ length: 1000 }, (_, index): MoleculeTab => ({
    id: `tab-${index}`, location: { kind: "launcher" }, back: [], forward: [],
    get pane() {
      examined++;
      return panes[index % panes.length];
    },
  }));
  useMoleculeStore.setState({ tabs, activeTabId: "tab-0" });
  useWorkspacePanesStore.setState({ selectedTabs: {}, fullViewTabId: null, floatingMinimized: false });
  let visible: string[] = [];
  let mostExamined = 0;
  function Probe() {
    const before = examined;
    const visibility = usePaneVisibility(false);
    visible = tabs.filter(tab => visibility(tab) === "visible").map(tab => tab.id);
    mostExamined = Math.max(mostExamined, examined - before);
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Probe />));
    await act(async () => useMoleculeStore.getState().setActiveTab("tab-996"));
    await act(async () => useMoleculeStore.getState().setActiveTab("tab-997"));
    expect(visible).toEqual(["tab-2", "tab-3", "tab-996", "tab-997"]);
    expect(mostExamined).toBeLessThan(tabs.length * 6);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

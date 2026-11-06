import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { findIndexedDocument } from "../apps/desktop/src/components/editor-area/document-index";

const browser = new Window({ url: "http://localhost" });
for (const key of ["window", "document", "navigator", "DocumentFragment", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "Event", "CustomEvent", "DOMRect", "MouseEvent", "KeyboardEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { EditorTabs } = await import("../apps/desktop/src/components/editor-area/editor-tabs");

test("document indexes preserve id priority, first-match drop identity and replacement-array freshness", () => {
  const first = { id: "a", path: "/same", title: "First" };
  const second = { id: "b", path: "/same", title: "Second" };
  const documents = [first, second];
  expect(findIndexedDocument(documents, { documentId: "b", path: "/same" })).toBe(second);
  expect(findIndexedDocument(documents, { documentId: "b", path: "/same" }, "first")).toBe(first);
  expect(findIndexedDocument(documents, { documentId: "missing", path: "/same" })).toBe(first);
  expect(findIndexedDocument(documents, { path: "/missing" })).toBeNull();
  const updated = { ...first, title: "Renamed" };
  expect(findIndexedDocument([updated, second], { path: "/same" })).toBe(updated);
  let reads = 0;
  const many = Array.from({ length: 1000 }, (_, index) => ({
    get id() { reads += 1; return `${index}`; }, path: `/${index}`,
  }));
  for (let index = 0; index < 1000; index += 1) {
    expect(findIndexedDocument(many, { documentId: `${index}`, path: "/missing" })).toBe(many[index]);
  }
  expect(reads).toBeLessThanOrEqual(2000);
});

test("the main and right New tab menus open independent Files and Text tabs in the requested group", async () => {
  const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
  const original = useMoleculeStore.getState();
  const source = { id: "menu-source", path: "/source.pdb", title: "source.pdb", renderer: "molstar", extension: "pdb" };
  const scene = { id: "menu-scene", location: { kind: "file", path: source.path, documentId: source.id }, back: [], forward: [] } as const;
  const empty = { id: "menu-empty", location: { kind: "launcher" }, pane: "right", back: [], forward: [] } as const;
  useMoleculeStore.setState({ tabs: [{ ...scene, back: [], forward: [] }, { ...empty, back: [], forward: [] }], documents: [source] as any, activeTabId: empty.id });
  const container = document.createElement("main");
  container.className = "app-shell";
  document.body.append(container);
  const root = createRoot(container);
  const actions = new Proxy({}, { get: () => () => {} });
  function Fixture() {
    const store = useMoleculeStore();
    const state: any = { ...store, sidebarProjects: [], dirtyGridDocuments: new Set() };
    return <><EditorTabs state={state} actions={actions as any} group="main" /><EditorTabs state={state} actions={actions as any} group="right" /></>;
  }
  const pick = async (group: "main" | "right", title: string) => {
    await act(async () => container.querySelector<HTMLButtonElement>(`[data-workspace-group="${group}"] button[aria-label="New tab"][aria-haspopup="menu"]`)!.click());
    const items = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map(node => node.textContent?.trim())).toContain(title);
    await act(async () => items.find(node => node.textContent?.trim() === title)!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };
  try {
    await act(async () => root.render(<Fixture />));
    await pick("right", "Text");
    expect(useMoleculeStore.getState().tabs.find(tab => tab.id === empty.id)).toMatchObject({
      pane: "right", location: { kind: "tool", tool: "text", sourcePath: source.path },
    });
    await pick("right", "Files");
    await pick("main", "Files");
    const tabs = useMoleculeStore.getState().tabs;
    expect(tabs.find(tab => tab.id === scene.id)).toEqual(scene);
    expect(tabs.filter(tab => tab.location.kind === "tool" && tab.location.tool === "files").map(tab => tab.pane ?? null)).toEqual(["right", null]);
  } finally {
    await act(async () => { window.dispatchEvent(new browser.Event("blur")); root.unmount(); });
    container.remove();
    useMoleculeStore.setState(original, true);
  }
});

test("1000 logical tabs keep bounded controls, keyboard wrap/focus, range drag and pinned close behavior", async () => {
  const previousRect = browser.HTMLElement.prototype.getBoundingClientRect;
  const previousWidth = Object.getOwnPropertyDescriptor(browser.HTMLElement.prototype, "clientWidth");
  Object.defineProperty(browser.HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 640; } });
  browser.HTMLElement.prototype.getBoundingClientRect = function () {
    const width = this.classList.contains("tab-shell") ? (this.dataset.tabId === "tab-0" ? 90 : 120) : 640;
    const left = this.classList.contains("tab-shell") ? Number.parseFloat(this.style.left || "0") - (this.closest(".tab-scroll-region")?.scrollLeft ?? 0) : 0;
    return new browser.DOMRect(left, 0, width, 32);
  };
  const documents = Array.from({ length: 1000 }, (_, index) => ({ id: `${index}`, path: `/${index}.pdb`, title: `${index}.pdb`, renderer: "molstar", extension: "pdb" }));
  let state: any = { documents, textDocuments: [], sidebarProjects: [], activeTabId: "tab-0", activeDocument: documents[0], dirtyGridDocuments: new Set(),
    tabs: documents.map((document, index) => ({ id: `tab-${document.id}`, location: { kind: "file", documentId: document.id, path: document.path }, back: [], forward: [], pinned: index === 0 })),
  };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const moves: unknown[] = [];
  const actions = new Proxy({}, { get: (_, key) => key === "selectTab" ? (id: string) => {
    state = { ...state, activeTabId: id }; render();
  } : key === "moveTab" ? (...args: unknown[]) => moves.push(args) : () => {} });
  const render = () => root.render(<EditorTabs state={state} actions={actions as any} />);
  const tab = (index: number) => container.querySelector<HTMLButtonElement>(`[data-tab-id="tab-${index}"] [role="tab"]`)!;
  const key = async (index: number, value: string) => act(async () => tab(index).dispatchEvent(new browser.KeyboardEvent("keydown", { bubbles: true, key: value })));
  const scrollTo = async (index: number) => act(async () => {
    const viewport = container.querySelector<HTMLElement>(".tab-scroll-region")!;
    // Offscreen widths begin as estimates; scroll to a known shell's virtual
    // offset by making it active, then keep scrolling independent of selection.
    state = { ...state, activeTabId: `tab-${index}` }; render();
    viewport.dispatchEvent(new browser.Event("scroll"));
  });
  try {
    await act(async () => render());
    expect(container.querySelectorAll('[role="tab"]').length).toBeLessThan(25);
    expect(container.querySelector('[data-tab-id="tab-0"] .tab-close')).toBeNull();
    await key(0, "End");
    expect(document.activeElement).toBe(tab(999));
    expect(tab(999).getAttribute("aria-posinset")).toBe("1000");
    expect(tab(999).getAttribute("aria-setsize")).toBe("1000");
    await act(async () => {
      const viewport = container.querySelector<HTMLElement>(".tab-scroll-region")!;
      viewport.scrollLeft = 0;
      viewport.dispatchEvent(new browser.Event("scroll"));
    });
    expect(tab(0)).not.toBeNull();
    expect(document.activeElement).toBe(tab(999));
    expect(container.querySelector<HTMLElement>(".tab-scroll-region")!.scrollLeft).toBe(0);
    await key(999, "ArrowRight"); expect(document.activeElement).toBe(tab(0));
    await key(0, "ArrowLeft"); expect(document.activeElement).toBe(tab(999));
    await scrollTo(500);
    await act(async () => tab(500).dispatchEvent(new browser.MouseEvent("click", { bubbles: true, ctrlKey: true })));
    await scrollTo(700);
    await act(async () => tab(700).dispatchEvent(new browser.MouseEvent("click", { bubbles: true, shiftKey: true })));
    const payloads = new Map<string, string>();
    const drag = new browser.Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(drag, "dataTransfer", { value: { setData: (type: string, value: string) => payloads.set(type, value), clearData: () => {} } });
    await act(async () => tab(700).dispatchEvent(drag));
    const payload = JSON.parse(payloads.get("application/x-burette-structure-paths")!);
    expect(payload.paths).toEqual(documents.slice(500, 701).map(document => document.path));
    expect(container.querySelectorAll('[role="tab"]').length).toBeLessThan(25);
    const point = document.elementFromPoint;
    document.elementFromPoint = () => container.querySelector(".tab-strip");
    await act(async () => window.dispatchEvent(new browser.CustomEvent("burette-native-tab-drop", { detail: { tabId: "tab-700", x: 100, y: 10 } })));
    document.elementFromPoint = point;
    expect(moves.length).toBe(1);
    expect((moves[0] as [string, number])[1]).toBeGreaterThan(600);
  } finally {
    await act(async () => root.unmount()); container.remove();
    browser.HTMLElement.prototype.getBoundingClientRect = previousRect;
    if (previousWidth) Object.defineProperty(browser.HTMLElement.prototype, "clientWidth", previousWidth);
    else delete (browser.HTMLElement.prototype as any).clientWidth;
  }
});

test("pointer reorder survives action replacement and Escape restores the original order", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const previousPoint = document.elementFromPoint;
  const previousRect = browser.HTMLElement.prototype.getBoundingClientRect;
  const tabs = ["a", "b", "c"].map(id => ({ id, location: { kind: "jobs" }, back: [], forward: [] }));
  let state: any = { documents: [], textDocuments: [], sidebarProjects: [], activeTabId: "a", dirtyGridDocuments: new Set(), tabs };
  let captured = false;
  const render = () => {
    // Shell actions are recreated when tab state changes in the real app.
    const actions = new Proxy({}, { get: (_, key) => key === "moveTab" ? (id: string, index: number) => {
      const moved = state.tabs.find((tab: any) => tab.id === id);
      const next = state.tabs.filter((tab: any) => tab.id !== id);
      next.splice(index, 0, moved);
      state = { ...state, tabs: next }; render();
    } : () => {} });
    root.render(<EditorTabs state={state} actions={actions as any} />);
  };
  browser.HTMLElement.prototype.getBoundingClientRect = function () {
    const index = state.tabs.findIndex((tab: any) => tab.id === this.dataset.tabId);
    return new browser.DOMRect(index >= 0 ? index * 100 : 0, 0, index >= 0 ? 100 : 400, 28);
  };
  document.elementFromPoint = () => container.querySelector(".tab-strip");
  const move = async (x: number) => act(async () => window.dispatchEvent(new browser.PointerEvent("pointermove", { pointerId: 1, buttons: 1, clientX: x, clientY: 10 })));
  try {
    await act(async () => render());
    const button = container.querySelector<HTMLButtonElement>('[data-tab-id="a"] [role="tab"]')!;
    button.setPointerCapture = () => { captured = true; };
    button.hasPointerCapture = () => captured;
    button.releasePointerCapture = () => { captured = false; };
    await act(async () => button.dispatchEvent(new browser.PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: 10, clientY: 10 })));
    await move(280);
    expect(state.tabs.map((tab: any) => tab.id)).toEqual(["b", "c", "a"]);
    await move(110);
    expect(state.tabs.map((tab: any) => tab.id)).toEqual(["b", "a", "c"]);
    await act(async () => window.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape" })));
    expect(state.tabs.map((tab: any) => tab.id)).toEqual(["a", "b", "c"]);
    expect(captured).toBe(false);
  } finally {
    await act(async () => root.unmount()); container.remove();
    document.elementFromPoint = previousPoint;
    browser.HTMLElement.prototype.getBoundingClientRect = previousRect;
  }
});

test("a drop belongs only to its target pane and retains the same tab", async () => {
  const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
  const original = useMoleculeStore.getState();
  const tabs: any[] = [
    { id: "a", location: { kind: "jobs" }, back: [], forward: [], title: "Calculation", pinned: true },
    { id: "d", location: { kind: "ketcher" }, back: [], forward: [] },
    { id: "b", location: { kind: "jobs" }, back: [], forward: [], pane: "right" },
    { id: "c", location: { kind: "jobs" }, back: [], forward: [], pane: "right" },
  ];
  useMoleculeStore.setState({ tabs, activeTabId: "a", documents: [], textDocuments: [] });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const previousPoint = document.elementFromPoint;
  let moves = 0;
  function Fixture() {
    const store = useMoleculeStore();
    const state: any = { ...store, sidebarProjects: [], dirtyGridDocuments: new Set() };
    const actions = new Proxy({}, { get: (_, key) => key === "moveTab" ? (id: string, index: number) => {
      moves++; useMoleculeStore.getState().moveTab(id, index);
    } : () => {} });
    return <><EditorTabs state={state} actions={actions as any} group="main" /><EditorTabs state={state} actions={actions as any} group="right" /></>;
  }
  try {
    await act(async () => root.render(<Fixture />));
    document.elementFromPoint = () => container.querySelector('[data-workspace-group="right"]');
    const source = container.querySelector<HTMLButtonElement>('[data-tab-id="d"] [role="tab"]')!;
    let captured = false;
    source.setPointerCapture = () => { captured = true; };
    source.hasPointerCapture = () => captured;
    source.releasePointerCapture = () => { captured = false; };
    const beforeDrag = { tabs: useMoleculeStore.getState().tabs, activeTabId: useMoleculeStore.getState().activeTabId };
    await act(async () => source.dispatchEvent(new browser.PointerEvent("pointerdown", { bubbles: true, pointerId: 3, button: 0, buttons: 1, clientX: 10, clientY: 10 })));
    await act(async () => window.dispatchEvent(new browser.PointerEvent("pointermove", { pointerId: 3, buttons: 1, clientX: 100, clientY: 10 })));
    // Hovering another pane previews a destination, but does not commit ownership.
    expect({ tabs: useMoleculeStore.getState().tabs, activeTabId: useMoleculeStore.getState().activeTabId }).toEqual(beforeDrag);
    await act(async () => window.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape" })));
    expect({ tabs: useMoleculeStore.getState().tabs, activeTabId: useMoleculeStore.getState().activeTabId }).toEqual(beforeDrag);
    expect(captured).toBe(false);
    moves = 0;
    await act(async () => window.dispatchEvent(new browser.CustomEvent("burette-native-tab-drop", { detail: { tabId: "a", x: -10, y: 10 } })));
    expect(moves).toBe(1);
    expect({ main: useMoleculeStore.getState().tabs.filter(tab => !tab.pane).map(tab => tab.id), right: useMoleculeStore.getState().tabs.filter(tab => tab.pane === "right").map(tab => tab.id) }).toEqual({ main: ["d"], right: ["a", "b", "c"] });
    expect(useMoleculeStore.getState().tabs.find(tab => tab.id === "a")).toEqual({ ...tabs[0], pane: "right" });
  } finally {
    await act(async () => root.unmount()); container.remove();
    document.elementFromPoint = previousPoint;
    useMoleculeStore.setState(original);
  }
});

test("preview title promotes on double click and on every editable dirty surface", async () => {
  const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
  const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
  const original = useMoleculeStore.getState();
  const tab: any = { id: "preview", location: { kind: "file", documentId: "doc", path: "/sample.pdb" }, back: [], forward: [], preview: true };
  const file: any = { id: "doc", path: "/sample.pdb", title: "sample.pdb", renderer: "molstar", extension: "pdb" };
  let mode = "clean";
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  function Fixture() {
    const store = useMoleculeStore();
    const state: any = { ...store, sidebarProjects: [], dirtyGridDocuments: new Set(mode === "grid" ? ["doc"] : []) };
    const source: any = { sessionForDocument: () => ({ dirty: mode === "source", saving: mode === "saving" }) };
    return <SourceEditingProvider value={source}><EditorTabs state={state} actions={new Proxy({}, { get: () => () => {} }) as any} /></SourceEditingProvider>;
  }
  try {
    useMoleculeStore.setState({ tabs: [tab], activeTabId: tab.id, documents: [file], textDocuments: [] });
    await act(async () => root.render(<Fixture />));
    expect(container.querySelector(".tab-title")?.classList.contains("italic")).toBe(true);
    await act(async () => container.querySelector('[role="tab"]')!.dispatchEvent(new browser.MouseEvent("dblclick", { bubbles: true })));
    expect(useMoleculeStore.getState().tabs[0].preview).toBe(false);
    expect(container.querySelector(".tab-title")?.classList.contains("italic")).toBe(false);
    for (mode of ["grid", "scene", "source", "saving"]) {
      await act(async () => {
        useMoleculeStore.setState({ tabs: [{ ...tab }], documents: [{ ...file, sceneUnsaved: mode === "scene" }] });
        root.render(<Fixture />);
      });
      expect(useMoleculeStore.getState().tabs[0].preview).toBe(false);
    }
  } finally { await act(async () => root.unmount()); container.remove(); useMoleculeStore.setState(original); }
});

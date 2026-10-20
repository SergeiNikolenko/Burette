import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { findIndexedDocument } from "../apps/desktop/src/components/editor-area/document-index";

const browser = new Window({ url: "http://localhost" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
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

test("1000 logical tabs keep bounded controls, keyboard wrap/focus, range drag and pinned close behavior", async () => {
  const previousRect = browser.HTMLElement.prototype.getBoundingClientRect;
  const previousWidth = Object.getOwnPropertyDescriptor(browser.HTMLElement.prototype, "clientWidth");
  Object.defineProperty(browser.HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 640; } });
  browser.HTMLElement.prototype.getBoundingClientRect = function () {
    const width = this.classList.contains("tab-shell") ? (this.dataset.tabId === "tab-0" ? 90 : 120) : 640;
    const left = this.classList.contains("tab-shell") ? Number.parseFloat(this.style.left || "0") - (this.closest(".tab-scroll-region")?.scrollLeft ?? 0) : 0;
    return new browser.DOMRect(left, 0, width, 28);
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
    expect(container.querySelector('[aria-label="Close 0.pdb"]')).toBeNull();
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
    await act(async () => window.dispatchEvent(new browser.CustomEvent("burette-native-tab-drop", { detail: { tabId: "tab-700", x: 100 } })));
    expect(moves.length).toBe(1);
    expect((moves[0] as [string, number])[1]).toBeGreaterThan(600);
  } finally {
    await act(async () => root.unmount()); container.remove();
    browser.HTMLElement.prototype.getBoundingClientRect = previousRect;
    if (previousWidth) Object.defineProperty(browser.HTMLElement.prototype, "clientWidth", previousWidth);
    else delete (browser.HTMLElement.prototype as any).clientWidth;
  }
});

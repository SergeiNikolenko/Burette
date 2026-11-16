import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";

const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({ window: browser, self: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, HTMLInputElement: browser.HTMLInputElement,
  HTMLSelectElement: browser.HTMLSelectElement, HTMLButtonElement: browser.HTMLButtonElement, HTMLFormElement: browser.HTMLFormElement,
  DocumentFragment: browser.DocumentFragment, NodeFilter: browser.NodeFilter, SVGElement: browser.SVGElement,
  CustomEvent: browser.CustomEvent, Event: browser.Event, FocusEvent: browser.FocusEvent, KeyboardEvent: browser.KeyboardEvent,
  MouseEvent: browser.MouseEvent, PointerEvent: browser.PointerEvent, MutationObserver: browser.MutationObserver, CSS: browser.CSS,
  localStorage: browser.localStorage, getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0), cancelAnimationFrame: clearTimeout,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterAll(async () => { await browser.happyDOM.close(); for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } });
const { createRoot } = await import("react-dom/client");
const { CommandPalette } = await import("../apps/desktop/src/components/command-palette");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");

const file = (name: string, extension: string) => ({ id: `editing-${name}`, title: name, path: `/structures/${name}`, extension, renderer: "molstar" }) as ViewerDocument;

async function palette(document: ViewerDocument, query: string) {
  const calls: unknown[][] = [];
  const actions = { setDockDocument: (...args: unknown[]) => calls.push(["document", ...args]), openDockTab: (...args: unknown[]) => calls.push(["tab", ...args]) };
  const state = { page: "viewer", documents: [document], textDocuments: [], activeDocument: document, activeTab: { id: "editing", location: { kind: "document", path: document.path }, back: [], forward: [] },
    preferences: defaultPreferences, sidebarProjects: [], visibleDocuments: [document], xtbJobs: [] };
  const host = globalThis.document.createElement("div"); globalThis.document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<CommandPalette state={state as unknown as ShellViewState} actions={actions as unknown as ShellActions} isOpen query={query}
    onQueryChange={() => {}} onClose={() => {}} onRunError={error => { throw error; }} />));
  const items = () => [...globalThis.document.querySelectorAll<HTMLElement>("[cmdk-item]")];
  return { calls, items, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

// Edit and Geometry open from the palette for the active structure, not only from
// the dock's add-tab menu, and only where that dock can edit the file.
test("palette opens the editing dock that fits the active structure", async () => {
  for (const [document, label, kind] of [[file("water.mol", "mol"), "Edit atoms and bonds", "structure-edit"], [file("water.xyz", "xyz"), "Edit geometry", "geometry"]] as const) {
    const view = await palette(document, "edit");
    try {
      const items = view.items().filter(node => node.textContent?.startsWith("Edit "));
      expect(items.map(node => node.textContent)).toEqual([label]);
      await act(async () => items[0].click());
      expect(view.calls).toEqual([["document", "right", document.id], ["tab", "right", kind]]);
    } finally { await view.close(); }
  }
});

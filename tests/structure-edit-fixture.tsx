import assert from "node:assert/strict";
import { Window } from "happy-dom";
import React, { act, useState } from "react";
import type { RootOptions } from "react-dom/client";
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { ShellActions, StructureViewerAction } from "../apps/desktop/src/components/types";
import type { DraftUpdateOptions, SourceEditingView } from "../apps/desktop/src/lib/source-editing/context";
import type { GraphMetadata } from "../apps/desktop/src/lib/workbench/graph-metadata";


const browser = new Window({ url: "http://localhost/" });

for (const [name, value] of Object.entries({
  window: browser,
  self: browser,
  document: browser.document,
  Node: browser.Node,
  Element: browser.Element,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLFormElement: browser.HTMLFormElement,
  HTMLButtonElement: browser.HTMLButtonElement,
  DocumentFragment: browser.DocumentFragment,
  MutationObserver: browser.MutationObserver,
  NodeFilter: browser.NodeFilter,
  HTMLDivElement: browser.HTMLDivElement,
  SVGElement: browser.SVGElement,
  CustomEvent: browser.CustomEvent,
  DOMRect: browser.DOMRect,
  Event: browser.Event,
  FocusEvent: browser.FocusEvent,
  KeyboardEvent: browser.KeyboardEvent,
  MouseEvent: browser.MouseEvent,
  PointerEvent: browser.PointerEvent,
  navigator: browser.navigator,
  localStorage: browser.localStorage,
  requestAnimationFrame: (callback: () => void) => browser.setTimeout(callback, 0),
  cancelAnimationFrame: (id: ReturnType<typeof browser.setTimeout>) => browser.clearTimeout(id),
  getComputedStyle: browser.getComputedStyle.bind(browser),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}
browser.HTMLElement.prototype.setPointerCapture = () => {};
browser.HTMLElement.prototype.releasePointerCapture = () => {};
browser.HTMLElement.prototype.hasPointerCapture = () => true;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { mock } = await import("bun:test");

// Ethanol without hydrogens, as an SDF record with a title and one data item.
export const source = [
  "ethanol", "  Burette           3D", "",
  "  3  2  0  0  0  0  0  0  0  0999 V2000",
  "    3.3961    1.6255    1.9216 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    2.4505    0.5871    1.3772 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    2.6687    0.4272   -0.0178 O   0  0  0  0  0  0  0  0  0  0  0  0",
  "  1  2  1  0  0  0  0",
  "  2  3  1  0  0  0  0",
  "M  END",
  "> <ID>",
  "EtOH-1",
  "",
  "$$$$",
  "",
].join("\n");

export const doc: ViewerDocument = { id: "ethanol", title: "ethanol.sdf", path: "/ethanol.sdf", extension: "sdf", renderer: "molstar", runtimePath: "", byteCount: new TextEncoder().encode(source).byteLength };
export const writes: { content: string; options?: DraftUpdateOptions }[] = [];
export const viewerActions: StructureViewerAction[] = [];
export let session: SourceEditingView | null = null;
let rerender = () => {};
mock.module("../apps/desktop/src/lib/structure-text", () => ({ readStructureText: async () => source, readStructureTextDocument: async () => { throw new Error("Not read here"); } }));
mock.module("../apps/desktop/src/lib/source-editing/context", () => ({ useSourceEditing: () => ({
  captureOperation: () => ({ isCurrent: () => true, release() {} }),
  sessionForDocument: () => session,
  beginEditing: async (document: ViewerDocument) => { session = { sessionId: crypto.randomUUID(), documentId: document.id, content: source, path: document.path, editable: true, dirty: false, saving: false, status: "", previewMode: "live", sourcePreview: null, saveDisabledReason: null, diagnostic: null }; },
  updateDraft: (_document: ViewerDocument, content: string, options?: DraftUpdateOptions) => {
    writes.push({ content, options });
    assert.ok(session); session = { ...session, content, dirty: content !== source };
    rerender();
  },
  save: async () => {},
}) }));

const { createRoot } = await import("react-dom/client");
export const { StructureEditPanel } = await import("../apps/desktop/src/components/workbench/structure-edit-panel");
export const { rememberViewerAtomSelection } = await import("../apps/desktop/src/lib/workbench/selection");

export function Fixture({ document = doc }: { document?: ViewerDocument }) {
  useFixtureRender();
  return <StructureEditPanel document={document} actions={actions} />;
}

export async function until(host: Element, condition: () => unknown, what: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
  }
  assert.fail(`timed out waiting for ${what}\n${host.textContent}`);
}

export const click = (element: Element | null | undefined, init: MouseEventInit = {}) => act(async () => { assert.ok(element); element.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init })); });
export const button = (host: ParentNode, text: string) => {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text || item.getAttribute("aria-label") === text);
  assert.ok(result, `Missing button: ${text}`); return result;
};

// Sparse shell seams are deliberate: supplied members are type-checked, any
// unexpected action invocation fails immediately instead of silently succeeding.
export function shellActions(values: Partial<ShellActions>): ShellActions {
  return new Proxy(values, {
    get(target, key) {
      if (typeof key === "symbol" || key in target) return Reflect.get(target, key);
      return () => { throw new Error(`Unexpected shell action: ${String(key)}`); };
    },
  }) as ShellActions;
}
const actions = shellActions({ runStructureViewerAction: async (_document, action) => { viewerActions.push(action); } });
export function createHost(options?: RootOptions) {
  const host = document.createElement("div"); document.body.append(host);
  return { host, root: createRoot(host, options) };
}
export function replaceSource(content: string) { assert.ok(session); session = { ...session, content }; rerender(); }
export const metadata = (text: string): GraphMetadata => { const match = text.match(/> <BURETTE_METADATA_V1>\n([^\n]+)/u); assert.ok(match); return JSON.parse(match[1]); };

export function topologyFixture() {
  const other = { ...doc, id: "ethanol-topology", path: "/ethanol-topology.sdf" };
  session = null;
  writes.length = 0;
  const errors: unknown[] = [];
  function Host() {
    useFixtureRender();
    return <StructureEditPanel document={other} actions={actions} />;
  }
  // No error boundary: a render error reaches the root, as it reached the app's global one.
  const { root, host } = createHost({ onUncaughtError: (error) => errors.push(error), onCaughtError: (error) => errors.push(error) });
  const rows = () => host.querySelectorAll("[data-atom]").length;
  const selectedRows = () => [...host.querySelectorAll('[data-atom][aria-selected="true"]')].map((row) => row.getAttribute("data-atom"));
  const step = async (name: string, count: number) => {
    const before = writes.length;
    await click(button(host, name));
    await until(host, () => writes.length === before + 1 && rows() === count && !host.querySelector('[role="status"] .sr-only'), name);
  };
  return { Host, host, root, rows, selectedRows, step, errors };
}

export function metadataFixture() {
  session = null; writes.length = 0;
  const { host, root } = createHost();
  const input = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  const fill = async (label: string, value: string) => act(async () => {
    const element = input(label); assert.ok(element);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  return { host, root, input, fill };
}

export function resetSource(clearWrites = false) { session = null; if (clearWrites) writes.length = 0; }
export function useFixtureRender() {
  const [, setTick] = useState(0);
  rerender = () => setTick((tick) => tick + 1);
}

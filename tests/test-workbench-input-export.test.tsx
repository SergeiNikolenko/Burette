import assert from "node:assert/strict";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { TextFileSaveOutcome } from "../apps/desktop/src/lib/file-export";

const previous = new Map<string, PropertyDescriptor | undefined>();
const window = new Window({ url: "http://localhost/" });
for (const [name, value] of Object.entries({
  window, self: window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement, HTMLFormElement: window.HTMLFormElement, HTMLSelectElement: window.HTMLSelectElement,
  SVGElement: window.SVGElement, DocumentFragment: window.DocumentFragment, MutationObserver: window.MutationObserver,
  CustomEvent: window.CustomEvent, Event: window.Event, FocusEvent: window.FocusEvent, KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent, PointerEvent: window.PointerEvent, navigator: window.navigator, localStorage: window.localStorage,
  NodeFilter: window.NodeFilter, getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value, writable: true }); }
previous.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true });

const { afterAll, mock, test } = await import("bun:test");
afterAll(async () => { await new Promise(resolve => setTimeout(resolve, 10)); await window.happyDOM.close(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } });
mock.module("../apps/desktop/src/components/workbench/use-workbench-source", () => ({
  useWorkbenchSource: () => ({ source: null, loading: false, error: null }),
}));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => false }));
const { createRoot } = await import("react-dom/client");
const { Dialog, DialogContent } = await import("../apps/desktop/src/components/ui/dialog");
const { InputExportDialogBody } = await import("../apps/desktop/src/components/workbench/input-export-dialog");

test("input export retains its result through clipboard and save failures and allows retry", async () => {
  const title = `${"water-with-a-long-source-title-".repeat(6)}.xyz`;
  const source = { runtimePath: "", byteCount: 0, id: "water", title, path: "/water.xyz", extension: "xyz", renderer: "molstar" as const };
  const atoms = [{ element: "O", x: 0, y: 0, z: 0 }, { element: "H", x: 0.96, y: 0, z: 0 }, { element: "H", x: -0.24, y: 0.93, z: 0 }];
  const saved: { title: string; extension: string; text: string }[] = [];
  let outcome: TextFileSaveOutcome = { status: "failed", message: "native_save /private/runtime failed" };
  let pending: PromiseWithResolvers<TextFileSaveOutcome> | null = null;
  const actions = { saveKetcherExportFile: async (request: (typeof saved)[number]) => {
    saved.push(request);
    return pending ? pending.promise : outcome;
  } } as ShellActions;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const button = (text: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === text) as HTMLButtonElement;
  const click = (text: string) => act(async () => { button(text).click(); await Promise.resolve(); });
  const alert = () => document.querySelector('[role="alert"]')?.textContent;
  const clipboardError = new Error("NotAllowedError: blocked by browser policy");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw clipboardError; } } });
  try {
    await act(async () => root.render(<Dialog open><DialogContent><InputExportDialogBody document={source} atoms={atoms} actions={actions} /></DialogContent></Dialog>));
    const text = (document.querySelector("textarea") as HTMLTextAreaElement).value;
    assert.match(text, /B3LYP/u);
    assert.equal(document.querySelector('button[role="combobox"]')?.getAttribute("aria-label"), "Calculation");
    assert.equal(button("Save").title.length > 100, true);
    await click("Copy");
    assert.equal(alert(), "Could not copy. Select the input text and copy it manually.");
    assert.equal((document.querySelector("textarea") as HTMLTextAreaElement).value, text);
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied.push(value); } } });
    await click("Copy");
    assert.deepEqual(copied, [text]);
    assert.ok(button("Copied"));
    assert.equal(alert(), undefined);
    await click("Save");
    assert.equal(alert(), "Could not save the input file. Try saving again.");
    assert.equal(saved[0].text, text);
    pending = Promise.withResolvers<TextFileSaveOutcome>();
    await click("Save");
    assert.equal(button("Saving").disabled, true);
    await act(async () => { pending!.resolve({ status: "cancelled" }); await pending!.promise; });
    pending = null;
    assert.ok(button("Save"));
    assert.equal(alert(), undefined);
    outcome = { status: "saved", path: null };
    await click("Save");
    assert.equal(saved.length, 3);
    assert.equal(alert(), undefined);
    assert.equal((document.querySelector("textarea") as HTMLTextAreaElement).value, text);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

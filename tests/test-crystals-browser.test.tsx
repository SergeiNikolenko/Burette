import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { CRYSTALS_RESOURCE, verifyResourceBundle } from "../apps/desktop/src/lib/extensions/resource-bundle";
import type { CrystalOpenRequest } from "../apps/desktop/src/lib/extensions/open-crystal";

const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLIFrameElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? browser : browser[key] });
}
previous.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterAll(() => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const { createRoot } = await import("react-dom/client");
const { CrystalsBrowser } = await import("../apps/desktop/src/components/settings-panel/crystals-browser");
const resource = await verifyResourceBundle(CRYSTALS_RESOURCE, new Uint8Array(readFileSync(new URL("../resources/extensions/openchemistry-crystals.bin", import.meta.url))));
const paths = resource.files.filter(file => file.path.endsWith(".cif")).map(file => file.path);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(onOpen: (request: CrystalOpenRequest) => Promise<string>) {
  const host = browser.document.createElement("div"); browser.document.body.append(host); const root = createRoot(host);
  const render = (installed = true) => act(async () => root.render(<CrystalsBrowser resource={installed ? resource : null} onOpen={onOpen} />));
  await render();
  const input = () => host.querySelector<HTMLInputElement>('[aria-label="Search crystals"]')!;
  return { host, input, render,
    items: () => Array.from(host.querySelectorAll<HTMLElement>('[role="option"]')),
    button: (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === label)!,
    async fill(value: string) { await act(async () => {
      Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(input(), value);
      input().dispatchEvent(new browser.Event("input", { bubbles: true }));
    }); },
    async enter() { await act(async () => input().dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); },
    async close() { await act(async () => root.unmount()); await act(async () => browser.happyDOM.waitUntilComplete()); host.remove(); },
  };
}

test("real corpus stays paged at 25 full paths, searches the complete path and bounds input", async () => {
  const opened: CrystalOpenRequest[] = [], f = await fixture(async request => { opened.push(request); return "/actual/opened.cif"; });
  try {
    expect(f.items().map(item => item.getAttribute("data-value"))).toEqual(paths.slice(0, 25));
    expect(f.host.querySelector("output")?.textContent).toBe("1–25 of 524"); expect(f.button("Previous").disabled).toBe(true);
    await act(async () => f.button("Next").click());
    expect(f.items().map(item => item.getAttribute("data-value"))).toEqual(paths.slice(25, 50));
    expect(f.host.querySelector("output")?.textContent).toBe("26–50 of 524");
    await act(async () => { f.input().focus(); f.input().dispatchEvent(new browser.KeyboardEvent("keydown", { key: "End", bubbles: true })); });
    expect(f.items().find(item => item.getAttribute("aria-selected") === "true")?.getAttribute("data-value")).toBe(paths[49]);
    await f.enter();
    await f.fill("antimonides/AlSb.cif");
    expect(f.items().map(item => item.getAttribute("data-value"))).toEqual(["antimonides/AlSb.cif"]);
    await f.enter(); expect(opened).toEqual([{ path: paths[49], version: CRYSTALS_RESOURCE.version }, { path: "antimonides/AlSb.cif", version: CRYSTALS_RESOURCE.version }]);
    await f.fill("x".repeat(200)); expect(f.input().value.length).toBe(160);
    expect(f.items().length).toBe(0); expect(f.host.textContent).toContain("No matching crystals");
    expect(f.host.querySelector('[role="alert"]')).toBeNull();
    await f.render(false); expect(f.host.textContent).toBe("");
  } finally { await f.close(); }
});

test("opening is singleflight, disables controls and has no false empty or completion state", async () => {
  const gate = deferred<string>(); let calls = 0;
  const f = await fixture(async () => { calls++; return gate.promise; });
  try {
    await f.fill(paths[0]);
    await act(async () => { f.input().focus(); for (let i = 0; i < 2; i++) f.input().dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(calls).toBe(1); expect(f.input().disabled).toBe(true);
    expect(f.button("Next").disabled).toBe(true); expect(f.button("Previous").disabled).toBe(true);
    expect(f.host.textContent).not.toContain("No matching crystals"); expect(f.host.querySelector("output")?.textContent).toBe("Opening…");
    await act(async () => { gate.resolve(""); await gate.promise; });
    expect(f.host.querySelector('[role="alert"]')?.textContent).toBe("This crystal could not be opened. Try again.");
    expect(f.input().disabled).toBe(false); expect(f.items().length).toBe(1);
  } finally { gate.resolve(""); await f.close(); }
});

test("an open failure keeps its selection available for Retry and never shows raw diagnostics", async () => {
  const opened: CrystalOpenRequest[] = [];
  const f = await fixture(async request => { opened.push(request); if (opened.length === 1) throw new Error("secret backend details".repeat(100)); return "/actual/opened.cif"; });
  try {
    await f.fill(paths[12]); await f.enter();
    expect(f.host.querySelector('[role="alert"]')?.textContent).toBe("This crystal could not be opened. Try again.");
    expect(f.host.textContent).not.toContain("secret"); expect(f.host.textContent).not.toContain("No matching crystals");
    await act(async () => f.button("Retry").click());
    expect(opened).toEqual([{ path: paths[12], version: CRYSTALS_RESOURCE.version }, { path: paths[12], version: CRYSTALS_RESOURCE.version }]);
    expect(f.host.querySelector('[role="alert"]')).toBeNull(); expect(f.input().disabled).toBe(false);
  } finally { await f.close(); }
});

test("successful Retry returns focus to search without taking focus from another control", async () => {
  for (const moveFocus of [false, true]) {
    const gate = deferred<string>(); let attempts = 0;
    const f = await fixture(async () => { if (++attempts === 1) throw new Error("unavailable"); return gate.promise; });
    const outside = browser.document.createElement("button"); browser.document.body.append(outside);
    try {
      await f.fill(paths[0]); await f.enter();
      await act(async () => { f.button("Retry").focus(); f.button("Retry").click(); });
      if (moveFocus) await act(async () => outside.focus());
      await act(async () => { gate.resolve("/actual/opened.cif"); await gate.promise; });
      expect(f.host.querySelector('[role="alert"]')).toBeNull();
      expect(browser.document.activeElement === (moveFocus ? outside : f.input())).toBe(true);
    } finally { gate.resolve(""); await f.close(); outside.remove(); }
  }
});

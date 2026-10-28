import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useSyncExternalStore } from "react";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { createResourceStore } from "../apps/desktop/src/lib/extensions/resource-store";
import { createResourceInstallRunner } from "../apps/desktop/src/lib/extensions/resource-install-runner";
import { CRYSTALS_RESOURCE } from "../apps/desktop/src/lib/extensions/resource-bundle";

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
const { ExtensionsSection } = await import("../apps/desktop/src/components/settings-panel/extensions-section");
const bytes = new Uint8Array(readFileSync(new URL("../resources/extensions/openchemistry-crystals.bin", import.meta.url)));
type Runner = ReturnType<typeof createResourceInstallRunner>;
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
function until(runner: Runner, ready: () => boolean) {
  if (ready()) return Promise.resolve();
  return new Promise<void>(resolve => { const unsubscribe = runner.subscribe(() => { if (ready()) { unsubscribe(); resolve(); } }); });
}
async function fixture(runner: Runner) {
  const host = browser.document.createElement("div"); browser.document.body.append(host); const root = createRoot(host);
  function Probe() { const state = useSyncExternalStore(runner.subscribe, runner.getSnapshot); return <ExtensionsSection extensions={{ ...state, ...runner, openCrystalsStructure: async () => { throw new Error("No document opener in this fixture"); } }} />; }
  await act(async () => root.render(<Probe />));
  return { host, button(label: string) { return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; },
    async press(label: string) {
      const previousId = runner.getSnapshot().jobs[0]?.id;
      const done = until(runner, () => {
        const job = runner.getSnapshot().jobs[0]; return Boolean(job && job.id !== previousId && ["success", "failed", "cancelled"].includes(job.status));
      });
      await act(async () => { const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(node => node.getAttribute("aria-label") === label || node.textContent === label)!; button.click(); await done; });
    }, async close() { await act(async () => root.unmount()); await act(async () => browser.happyDOM.waitUntilComplete()); host.remove(); } };
}

test("loading and status read failure keep Install disabled; Retry refreshes rather than downloading", async () => {
  const pending = deferred<null>(); let reads = 0, requests = 0, unavailable = false;
  const store = createResourceStore(new IDBFactory());
  const runner = createResourceInstallRunner({ store: { ...store, getInstalled: async () => { reads++; if (unavailable) throw new Error("unavailable"); return pending.promise; } },
    fetcher: (async () => { requests++; return new Response(bytes); }) as typeof fetch });
  const refresh = runner.refresh(), f = await fixture(runner);
  try {
    expect(f.button("Install Crystals").disabled).toBe(true); expect(f.host.querySelector('[role="status"]')?.textContent).toBe("Loading…");
    await act(async () => { pending.resolve(null); await refresh; });
    expect(f.button("Install Crystals").disabled).toBe(false);
    unavailable = true; await act(async () => runner.refresh());
    expect(f.button("Install Crystals").disabled).toBe(true); expect(f.host.querySelector('[role="alert"]')?.textContent).toContain("could not be read");
    unavailable = false;
    await act(async () => { Array.from(f.host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Retry")!.click(); });
    expect(reads).toBe(3); expect(requests).toBe(0); expect(f.host.querySelector('[role="alert"]')).toBeNull();
  } finally { pending.resolve(null); await f.close(); }
});

test("install failure can be dismissed; streamed progress and cancellation stay truthful until cleanup, then install succeeds", async () => {
  const cleaning = deferred(), cleanup = deferred(); let requests = 0;
  const store = createResourceStore(new IDBFactory());
  const runner = createResourceInstallRunner({ store, fetcher: (async () => {
    if (++requests === 1) return new Response("failed", { status: 503 });
    if (requests > 2) return new Response(bytes);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 100)); }, cancel() { cleaning.resolve(); return cleanup.promise; } }));
  }) as typeof fetch });
  await runner.refresh(); const f = await fixture(runner);
  try {
    expect(f.host.textContent).toContain("Geoffrey Hutchison"); expect(f.host.querySelector('[aria-label="524 CIF structures"]')).not.toBeNull();
    await f.press("Install Crystals"); expect(f.host.querySelector('[role="alert"]')?.textContent).toContain("could not be installed");
    await act(async () => { const dismiss = Array.from(f.host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Dismiss")!; dismiss.focus(); dismiss.click(); });
    expect(f.host.querySelector('[role="alert"]')).toBeNull(); expect(runner.getSnapshot().jobs.length).toBe(1);
    expect(browser.document.activeElement === f.button("Install Crystals")).toBe(true);
    const streaming = until(runner, () => runner.getSnapshot().jobs[0]?.receivedBytes === 100);
    await act(async () => { f.button("Install Crystals").click(); await streaming; });
    expect(f.host.querySelector('[role="status"]')?.textContent).toBe("100 / 294,538 bytes");
    await act(async () => { f.button("Cancel Crystals installation").click(); await cleaning.promise; });
    expect(f.button("Cancel Crystals installation").disabled).toBe(true); expect(f.host.querySelector('[role="status"]')?.textContent).toBe("Cancelling…");
    const cancelled = until(runner, () => runner.getSnapshot().jobs[0]?.status === "cancelled");
    await act(async () => { cleanup.resolve(); await cancelled; });
    await f.press("Install Crystals");
    expect(f.host.querySelector('[role="status"]')?.textContent).toBe("Installed"); expect(f.button("Remove Crystals")).not.toBeNull();
    expect((await store.getInstalled(CRYSTALS_RESOURCE.id))!.files.length).toBe(526);
  } finally { cleanup.resolve(); runner.cancel(runner.getSnapshot().jobs[0]?.id ?? ""); await f.close(); }
});

test("Retry of a failed removal removes the installed resource without starting an installation", async () => {
  const store = createResourceStore(new IDBFactory()); await store.install(CRYSTALS_RESOURCE, bytes); let attempts = 0, requests = 0;
  const runner = createResourceInstallRunner({ store: { ...store, remove: async (...args) => { if (++attempts === 1) throw new Error("failed removal"); await store.remove(...args); } },
    fetcher: (async () => { requests++; return new Response(bytes); }) as typeof fetch });
  await runner.refresh(); const f = await fixture(runner);
  try {
    await f.press("Remove Crystals"); expect(f.host.querySelector('[role="alert"]')?.textContent).toContain("could not be removed");
    expect(f.host.querySelector('[role="status"]')?.textContent).toBe("Installed");
    await f.press("Retry"); expect(attempts).toBe(2); expect(requests).toBe(0);
    expect(f.button("Install Crystals")).not.toBeNull(); expect(await store.getInstalled(CRYSTALS_RESOURCE.id)).toBeNull();
  } finally { await f.close(); }
});

test("keyboard opens the links menu and selects only the fixed source and issues destinations", async () => {
  const runner = createResourceInstallRunner({ store: createResourceStore(new IDBFactory()) }); await runner.refresh();
  const f = await fixture(runner), opened: unknown[][] = [];
  const open = spyOn(browser, "open").mockImplementation((...args) => { opened.push(args); return null; });
  try {
    for (const text of ["Source", "Report an issue"]) {
      await act(async () => { const trigger = f.button("Crystals links"); trigger.focus(); trigger.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
      await act(async () => browser.happyDOM.waitUntilComplete());
      expect(f.button("Crystals links").getAttribute("aria-expanded")).toBe("true");
      const item = Array.from(browser.document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node => node.textContent === text)!;
      expect(item).toBeDefined();
      if (text === "Report an issue") await act(async () => browser.document.activeElement!.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
      await act(async () => browser.happyDOM.waitUntilComplete());
      expect(browser.document.activeElement === item).toBe(true);
      await act(async () => item.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      await act(async () => browser.happyDOM.waitUntilComplete());
      expect(browser.document.querySelector('[role="menu"]')).toBeNull();
    }
    expect(opened).toEqual([["https://github.com/OpenChemistry/crystals", "_blank", "noopener,noreferrer"], ["https://github.com/OpenChemistry/crystals/issues", "_blank", "noopener,noreferrer"]]);
  } finally { open.mockRestore(); await f.close(); }
});

for (const moveFocus of [false, true]) test(`successful Retry restores primary focus without stealing a later user move (${moveFocus})`, async () => {
  const fetching = deferred(), finish = deferred(); let requests = 0;
  const runner = createResourceInstallRunner({ store: createResourceStore(new IDBFactory()), fetcher: (async () => {
    if (++requests === 1) return new Response("failed", { status: 503 });
    fetching.resolve(); await finish.promise; return new Response(bytes);
  }) as typeof fetch });
  await runner.refresh(); const f = await fixture(runner);
  try {
    await f.press("Install Crystals");
    await act(async () => { const retry = Array.from(f.host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Retry")!; retry.focus(); retry.click(); await fetching.promise; });
    expect(browser.document.activeElement === f.button("Cancel Crystals installation")).toBe(true);
    if (moveFocus) await act(async () => f.button("Crystals links").focus());
    const done = until(runner, () => runner.getSnapshot().jobs[0]?.status === "success");
    await act(async () => { finish.resolve(); await done; });
    expect(browser.document.activeElement === f.button(moveFocus ? "Crystals links" : "Remove Crystals")).toBe(true);
  } finally { finish.resolve(); await f.close(); }
});

for (const action of ["Dismiss", "Retry"]) test(`${action} of a link error returns keyboard focus to the links control`, async () => {
  const runner = createResourceInstallRunner({ store: createResourceStore(new IDBFactory()) }); await runner.refresh();
  const f = await fixture(runner); let requests = 0;
  const open = spyOn(browser, "open").mockImplementation(() => { if (++requests === 1) throw new Error("blocked"); return null; });
  try {
    await act(async () => { const trigger = f.button("Crystals links"); trigger.focus(); trigger.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await act(async () => browser.happyDOM.waitUntilComplete());
    await act(async () => browser.document.activeElement!.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await act(async () => browser.happyDOM.waitUntilComplete());
    expect(f.host.querySelector('[role="alert"]')?.textContent).toBe("Could not open Source. Try again.");
    await act(async () => { const button = Array.from(f.host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === action)!; button.focus(); button.click(); });
    expect(f.host.querySelector('[role="alert"]')).toBeNull();
    expect(browser.document.activeElement === f.button("Crystals links")).toBe(true);
    expect(requests).toBe(action === "Retry" ? 2 : 1);
  } finally { open.mockRestore(); await f.close(); }
});

import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import React, { StrictMode, act } from "react";
import * as runners from "../apps/desktop/src/lib/extensions/resource-install-runner";
import { CRYSTALS_RESOURCE } from "../apps/desktop/src/lib/extensions/resource-bundle";
import { useResourceExtensions } from "../apps/desktop/src/hooks/use-resource-extensions";

const browser = new Window({ url: "http://localhost/" });
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLIFrameElement: browser.HTMLIFrameElement, Node: browser.Node,
  IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(() => {
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
const { createRoot } = await import("react-dom/client");
const createRunner = runners.createResourceInstallRunner;
const prior = { catalog: CRYSTALS_RESOURCE, files: [] };
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type Store = NonNullable<Parameters<typeof createRunner>[0]>["store"];
async function fixture(getInstalled: NonNullable<Store>["getInstalled"], fetcher: typeof fetch) {
  const runner = createRunner({ store: { getInstalled, install: async () => { throw new Error("Unexpected publication"); }, remove: async () => {} }, fetcher });
  const factory = spyOn(runners, "createResourceInstallRunner").mockReturnValue(runner);
  let latest!: ReturnType<typeof useResourceExtensions>;
  function Probe() { latest = useResourceExtensions(); return null; }
  const host = browser.document.createElement("div"); browser.document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<StrictMode><Probe /></StrictMode>));
  return { runner, get latest() { return latest; }, async close() {
    try { await act(async () => root.unmount()); } finally { host.remove(); factory.mockRestore(); }
  } };
}

test("StrictMode mount refresh invalidated by a failed install is reconciled without another focus event", async () => {
  const mountReads = deferred<typeof prior | null>(); let reads = 0;
  const f = await fixture(async () => ++reads <= 2 ? mountReads.promise : prior, (async () => new Response("failed", { status: 503 })) as typeof fetch);
  try {
    expect(reads).toBe(2); expect(f.latest.initialized).toBe(false);
    await act(async () => { expect((await f.latest.installCrystals()).status).toBe("failed"); });
    expect(f.latest.initialized).toBe(true); expect(f.latest.installed).toEqual(prior); expect(reads).toBe(3);
    await act(async () => { mountReads.resolve(null); await mountReads.promise; });
    expect(f.latest.installed).toEqual(prior);
  } finally { mountReads.resolve(null); await f.close(); }
});

for (const outcome of ["failed", "cancelled"]) test(`focus during a ${outcome} install reconciles external removal after cleanup`, async () => {
  let current: typeof prior | null = prior, reads = 0;
  const fetching = deferred(), finish = deferred();
  const f = await fixture(async () => { reads++; return current; }, (async () => {
    fetching.resolve(); await finish.promise; return new Response("failed", { status: 503 });
  }) as typeof fetch);
  try {
    expect(f.latest.installed).toEqual(prior);
    let pending!: ReturnType<typeof f.runner.installCrystals>;
    await act(async () => { pending = f.latest.installCrystals(); await fetching.promise; });
    current = null;
    await act(async () => {
      browser.dispatchEvent(new browser.Event("focus")); browser.dispatchEvent(new browser.Event("focus"));
      if (outcome === "cancelled") f.latest.cancel(f.latest.jobs[0].id);
    });
    expect(reads).toBe(2);
    await act(async () => { finish.resolve(); expect((await pending).status).toBe(outcome); });
    expect(f.latest.initialized).toBe(true); expect(f.latest.installed).toBeNull(); expect(reads).toBe(3);
  } finally { finish.resolve(); await f.close(); }
});

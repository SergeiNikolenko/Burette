import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import React, { act, useSyncExternalStore } from "react";
import { parseAvogadroPluginIndex, readBoundedText, MAX_PLUGIN_INDEX_BYTES } from "../apps/desktop/src/lib/extensions/avogadro-plugin-index";
import { createAvogadroCatalog, CATALOG_INVALID, CATALOG_UNREACHABLE } from "../apps/desktop/src/lib/extensions/avogadro-catalog";

// Recorded https://avogadro.cc/plugins2.json (Last-Modified 2026-11-01 12:04:11 GMT).
const savedText = readFileSync(new URL("../config/avogadro-plugin-index.snapshot.json", import.meta.url), "utf8");
const saved = JSON.parse(savedText) as Record<string, unknown>[];
// The real avogadro-rdkit archive the index points at, recorded from codeload.github.com.
const rdkitArchive = readFileSync(new URL("./fixtures/avogadro/avogadro-rdkit-82498e3a.zip", import.meta.url));

test("the recorded index is read completely and its archive hash matches the real package bytes", () => {
  const { plugins, skipped } = parseAvogadroPluginIndex(saved);
  expect(skipped).toBe(0);
  expect(plugins.length).toBe(saved.length);
  expect(new Set(plugins.map(plugin => plugin.name)).size).toBe(plugins.length);
  const rdkit = plugins.find(plugin => plugin.name === "avogadro-rdkit")!;
  expect(rdkit).toMatchObject({ license: "BSD-3-Clause", authors: ["Geoff Hutchison"], features: ["menu-commands"], packageKind: "python-package",
    repository: "https://github.com/ghutchis/avogadro-rdkit", commit: "82498e3a3cedc2d465ccdcd93cabec1b2505dc5a" });
  expect(createHash("sha256").update(rdkitArchive).digest("hex")).toBe(rdkit.archive.sha256);
  for (const plugin of plugins) expect(new URL(plugin.archive.url).hostname).toBe("plugins.avogadro.cc");
});

test("malformed or unsafe entries are dropped one by one; a non-list document is refused", () => {
  const good = saved[0];
  const variants = [
    { ...good, name: "evil‮name" },
    { ...good, name: "second", git: { ...(good.git as object), repo: "http://github.com/a/b.git" } },
    { ...good, name: "third", src: { url: "https://example.com/x.zip", sha256: "0".repeat(64) } },
    { ...good, name: "fourth", src: { ...(good.src as object), sha256: "not-a-hash" } },
    { ...good, name: "fifth", authors: "Somebody" },
    good,
    { ...good, description: "Duplicate name keeps the first entry" },
  ];
  const { plugins, skipped } = parseAvogadroPluginIndex(variants);
  expect(plugins.map(plugin => plugin.name)).toEqual([good.name as string]);
  expect(plugins[0].description).toBe(good.description as string);
  expect(skipped).toBe(6);
  expect(() => parseAvogadroPluginIndex({ plugins: saved })).toThrow();
});

test("streamed index text is bounded even without a length header", async () => {
  const chunk = new Uint8Array(256 * 1024).fill(32);
  const endless = new Response(new ReadableStream({ pull(controller) { controller.enqueue(chunk); } }));
  await expect(readBoundedText(endless)).rejects.toThrow("larger");
  await expect(readBoundedText(new Response("x", { headers: { "content-length": String(MAX_PLUGIN_INDEX_BYTES + 1) } }))).rejects.toThrow("larger");
  await expect(readBoundedText(new Response("gone", { status: 404 }))).rejects.toThrow();
  expect(await readBoundedText(new Response(savedText))).toBe(savedText);
});

test("the saved list shows first; failed refreshes keep the last good list with a deterministic message", async () => {
  let live: () => Promise<string> = async () => { throw new TypeError("offline"); };
  let calls = 0;
  const catalog = createAvogadroCatalog({ loadSaved: async () => saved, loadLive: () => { calls++; return live(); } });
  await Promise.all([catalog.refresh(), catalog.refresh()]);
  expect(calls).toBe(1);
  expect(catalog.getSnapshot()).toMatchObject({ source: "saved", status: "failed", error: CATALOG_UNREACHABLE });
  expect(catalog.getSnapshot().plugins.length).toBe(saved.length);

  const newer = [{ ...saved[0], version: "9.9.9" }];
  live = async () => JSON.stringify(newer);
  await catalog.refresh();
  expect(catalog.getSnapshot()).toMatchObject({ source: "live", status: "idle", error: null });
  expect(catalog.getSnapshot().plugins.map(plugin => plugin.version)).toEqual(["9.9.9"]);

  live = async () => "<html>maintenance</html>";
  await catalog.refresh();
  expect(catalog.getSnapshot()).toMatchObject({ source: "live", status: "failed", error: CATALOG_INVALID });
  expect(catalog.getSnapshot().plugins.map(plugin => plugin.version)).toEqual(["9.9.9"]);
});

const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "FocusEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? browser : browser[key] });
}
previous.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterAll(() => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });

test("catalog rows search, page, expand to inspectable details and retry a failed link", async () => {
  const { createRoot } = await import("react-dom/client");
  const { AvogadroPluginsSection } = await import("../apps/desktop/src/components/settings-panel/avogadro-plugins-section");
  const catalog = createAvogadroCatalog({ loadSaved: async () => saved, loadLive: async () => savedText });
  await catalog.refresh();
  const opened: string[] = []; let failNext = true;
  function Probe() {
    const state = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
    return <AvogadroPluginsSection catalog={state} onRetry={() => { void catalog.refresh(); }} openLink={async (plugin, link) => {
      if (failNext) { failNext = false; throw new Error("blocked"); }
      opened.push(`${plugin.name}:${link}`);
    }} />;
  }
  const host = browser.document.createElement("div"); browser.document.body.append(host);
  const root = createRoot(host);
  const button = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(node => node.getAttribute("aria-label") === label || node.textContent === label);
  try {
    await act(async () => root.render(<Probe />));
    expect(host.querySelectorAll("li").length).toBe(25);
    expect(host.querySelector("output")?.textContent).toBe(`1–25 of ${saved.length}`);
    await act(async () => button("Next")!.click());
    expect(host.querySelectorAll("li").length).toBe(saved.length - 25);

    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search Avogadro plugins"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(search, "charge models");
      search.dispatchEvent(new browser.Event("input", { bubbles: true }));
    });
    const names = Array.from(host.querySelectorAll("li .font-medium"), node => node.textContent);
    expect(names).toEqual(["avogadro-aimnet2", "avogadro-antechamber-charges", "avogadro-multicharge"]);
    expect(host.textContent).toContain("Desktop app");

    const details = button("avogadro-multicharge details")!;
    await act(async () => details.click());
    expect(details.getAttribute("aria-expanded")).toBe("true");
    const list = browser.document.getElementById(details.getAttribute("aria-controls")!)!;
    expect(list.textContent).toContain("BSD-3-Clause");
    expect(list.textContent).toContain("Charge models");
    await act(async () => button("Report an issue")!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not open Report an issue. Try again.");
    await act(async () => button("Retry")!.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(opened).toEqual(["avogadro-multicharge:issues"]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useSyncExternalStore } from "react";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { createResourceStore } from "../apps/desktop/src/lib/extensions/resource-store";
import { createResourceInstallRunner } from "../apps/desktop/src/lib/extensions/resource-install-runner";
import { CRYSTALS_RESOURCE } from "../apps/desktop/src/lib/extensions/resource-bundle";

const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLIFrameElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame", "localStorage"] as const) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? browser : browser[key] });
}
for (const [key, value] of Object.entries({ indexedDB: new IDBFactory(), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(() => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const { createRoot } = await import("react-dom/client");
const { useAppShellActions } = await import("../apps/desktop/src/hooks/use-app-shell-actions");
const { ExtensionsSection } = await import("../apps/desktop/src/components/settings-panel/extensions-section");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { openBrowserDevDocuments } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { readBrowserImport } = await import("../apps/desktop/src/lib/browser-import-storage");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const bytes = new Uint8Array(readFileSync(new URL("../resources/extensions/openchemistry-crystals.bin", import.meta.url)));

test("Extensions Browse uses the app action to open independent CIF documents, retry stale storage and retain imports after Remove", async () => {
  const store = createResourceStore(), resource = await store.install(CRYSTALS_RESOURCE, bytes);
  const runner = createResourceInstallRunner({ store }); await runner.refresh();
  const previousWorkspace = useMoleculeStore.getState();
  useMoleculeStore.setState({ documents: [], textDocuments: [], tabs: [], activeTabId: null, activeDocumentId: null });
  useMoleculeStore.getState().openSettingsSection("extensions");
  const paths: string[] = [];
  async function openPaths(incoming: string[], options: { requireSuccess?: boolean }) {
    expect(options.requireSuccess).toBe(true);
    const result = await openBrowserDevDocuments(incoming, defaultPreferences);
    if (result.documents.length !== incoming.length) throw new Error("No document opened");
    useMoleculeStore.getState().addDocuments(result.documents); paths.push(...incoming);
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Fixture() {
    const state = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
    const actions = useAppShellActions({ activeDocument: null, documents: [], tabs: [], openPaths, openStructureRecords: async () => { throw new Error("Browser must use the file path flow"); } } as never);
    return <ExtensionsSection extensions={{ ...state, ...runner, openCrystalsStructure: actions.openCrystalsStructure }} />;
  }
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
  async function choose() {
    await act(async () => button("Browse crystals").click());
    const input = host.querySelector<HTMLInputElement>('[aria-label="Search crystals"]')!;
    expect(document.activeElement).toBe(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(input, "antimonides/AlSb.cif");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const item = host.querySelector<HTMLElement>('[role="option"]')!;
    expect(item.textContent).toBe("antimonides/AlSb.cif");
    await act(async () => { item.click(); });
  }
  async function until(ready: () => boolean) {
    for (let attempt = 0; attempt < 100 && !ready(); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(ready()).toBe(true);
  }
  try {
    await act(async () => root.render(<Fixture />));
    await choose(); await until(() => paths.length === 1);
    let workspace = useMoleculeStore.getState();
    expect(workspace.documents.find(doc => doc.id === workspace.activeDocumentId)?.path).toBe(paths[0]);
    expect(host.querySelector('[aria-label="Crystal library"]')).toBeNull();
    const selected = resource.files.find(file => file.path === "antimonides/AlSb.cif")!;
    expect(new Uint8Array(await (await readBrowserImport(paths[0]))!.file.arrayBuffer())).toEqual(selected.data);
    // The UI can still show its snapshot when another writer has removed the library.
    useMoleculeStore.getState().openSettingsSection("extensions"); await store.remove(CRYSTALS_RESOURCE.id);
    await choose(); await until(() => Boolean(host.querySelector('[role="alert"]')));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("This crystal could not be opened. Try again.");
    expect(paths).toHaveLength(1); expect(useMoleculeStore.getState().activeDocumentId).toBeNull();
    await store.install(CRYSTALS_RESOURCE, bytes);
    await act(async () => button("Retry").click()); await until(() => paths.length === 2);
    workspace = useMoleculeStore.getState();
    expect(new Set(paths).size).toBe(2);
    expect(workspace.documents.find(doc => doc.id === workspace.activeDocumentId)?.path).toBe(paths[1]);
    expect(host.querySelector('[aria-label="Crystal library"]')).toBeNull();
    await act(async () => button("Remove Crystals").click());
    await until(() => runner.getSnapshot().installed === null);
    expect(button("Browse crystals")).toBeUndefined();
    for (const path of paths) expect(new Uint8Array(await (await readBrowserImport(path))!.file.arrayBuffer())).toEqual(selected.data);
  } finally {
    await act(async () => root.unmount()); host.remove();
    useMoleculeStore.setState(previousWorkspace, true);
  }
}, 15_000);

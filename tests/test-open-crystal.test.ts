import { afterAll, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { CRYSTALS_RESOURCE } from "../apps/desktop/src/lib/extensions/resource-bundle";
import { createResourceStore } from "../apps/desktop/src/lib/extensions/resource-store";
import { openInstalledCrystal } from "../apps/desktop/src/lib/extensions/open-crystal";
import { readBrowserImport } from "../apps/desktop/src/lib/browser-import-storage";
import { deleteBrowserDevVirtualTextDocument, openBrowserDevDocuments, readBrowserVirtualText } from "../apps/desktop/src/lib/browser-dev-documents";
import { defaultPreferences } from "../apps/desktop/src/stores/settings-store";
import type { ViewerDocument } from "../apps/desktop/src/types";

const imports = new IDBFactory(), previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: imports });
afterAll(async () => {
  await new Promise<void>((resolve, reject) => { const request = imports.deleteDatabase("burette-browser-imports"); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
  if (previous) Object.defineProperty(globalThis, "indexedDB", previous); else Reflect.deleteProperty(globalThis, "indexedDB");
});
const bytes = new Uint8Array(readFileSync(new URL("../resources/extensions/openchemistry-crystals.bin", import.meta.url)));
const request = (path: string) => ({ path, version: CRYSTALS_RESOURCE.version });
async function fixture() {
  const factory = new IDBFactory(), store = createResourceStore(factory), resource = await store.install(CRYSTALS_RESOURCE, bytes);
  const documents: ViewerDocument[] = [];
  const actions = { openPaths: async (paths: string[], options: { requireSuccess?: boolean } = {}) => {
    expect(options.requireSuccess).toBe(true);
    const opened = await openBrowserDevDocuments(paths, { ...defaultPreferences, rendererMode: "molstar" });
    if (opened.documents.length !== paths.length) throw new Error("No document opened");
    documents.push(...opened.documents);
  }, openStructureRecords: async () => [] as ViewerDocument[] };
  return { factory, store, resource, documents, actions };
}

test("a real CRLF CIF opens with original bytes, survives resource removal and restores independently", async () => {
  const f = await fixture(), selected = f.resource.files.find(file => file.path.endsWith(".cif") && new TextDecoder().decode(file.data).includes("\r\n"))!;
  const path = await openInstalledCrystal(request(selected.path), f.actions, { store: f.store, platform: "browser" });
  expect(f.documents.map(document => ({ path: document.path, extension: document.extension, renderer: document.renderer }))).toEqual([{ path, extension: "cif", renderer: "molstar" }]);
  expect(new Uint8Array(await (await readBrowserImport(path))!.file.arrayBuffer())).toEqual(selected.data);
  await f.store.remove(CRYSTALS_RESOURCE.id);
  expect(await f.store.getInstalled(CRYSTALS_RESOURCE.id)).toBeNull();
  deleteBrowserDevVirtualTextDocument(path);
  expect(new TextEncoder().encode((await readBrowserVirtualText(path))!)).toEqual(selected.data);
  const reopened = await openBrowserDevDocuments([path], defaultPreferences);
  expect(reopened.documents[0]?.path).toBe(path);
  expect(new Uint8Array(await (await readBrowserImport(path))!.file.arrayBuffer())).toEqual(selected.data);
});

test("repeated selections and duplicate basenames allocate distinct imported paths without overwriting originals", async () => {
  const f = await fixture(), originals = f.resource.files.filter(file => file.path.endsWith(".cif")).slice(0, 2);
  const resource = { ...f.resource, files: originals.map((file, i) => ({ ...file, path: `${i}/shared.cif` })) };
  const store = { getInstalled: async () => resource };
  const first = await openInstalledCrystal(request("0/shared.cif"), f.actions, { store, platform: "browser" });
  const second = await openInstalledCrystal(request("1/shared.cif"), f.actions, { store, platform: "browser" });
  const again = await openInstalledCrystal(request("0/shared.cif"), f.actions, { store, platform: "browser" });
  expect(new Set([first, second, again]).size).toBe(3);
  for (const [path, original] of [[first, originals[0]], [second, originals[1]], [again, originals[0]]] as const) {
    expect(new Uint8Array(await (await readBrowserImport(path))!.file.arrayBuffer())).toEqual(original.data);
  }
  expect(f.documents.map(document => document.path)).toEqual([first, second, again]);
});

test("stale versions, paths, missing resources and damaged stored bytes reject before opening", async () => {
  const f = await fixture(); let opened = 0;
  const actions = { openPaths: async () => { opened++; }, openStructureRecords: async () => { opened++; return []; } };
  for (const value of [{ ...request("antimonides/AlSb.cif"), version: "old" }, request("../escape.cif"), request("README.md"), request("missing.cif")]) {
    await expect(openInstalledCrystal(value, actions, { store: f.store })).rejects.toThrow("could not be opened");
  }
  for (const catalog of [{ ...f.resource.catalog, id: "other" }, { ...f.resource.catalog, version: "other" },
    { ...f.resource.catalog, compressed: { ...f.resource.catalog.compressed, sha256: "0".repeat(64) } },
    { ...f.resource.catalog, compressed: { ...f.resource.catalog.compressed, bytes: bytes.length + 1 } }]) {
    await expect(openInstalledCrystal(request("antimonides/AlSb.cif"), actions, { store: { getInstalled: async () => ({ ...f.resource, catalog }) } })).rejects.toThrow();
  }
  await new Promise<void>((resolve, reject) => {
    const opening = f.factory.open("burette-extension-resources", 1);
    opening.onsuccess = () => {
      const db = opening.result, tx = db.transaction("versions", "readwrite"), versions = tx.objectStore("versions"), row = versions.get([CRYSTALS_RESOURCE.id, CRYSTALS_RESOURCE.version]);
      row.onsuccess = () => { const value = row.result; value.compressed[40] ^= 1; versions.put(value); };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  });
  await expect(openInstalledCrystal(request("antimonides/AlSb.cif"), actions, { store: f.store })).rejects.toThrow();
  await f.store.remove(CRYSTALS_RESOURCE.id);
  await expect(openInstalledCrystal(request("antimonides/AlSb.cif"), actions, { store: f.store })).rejects.toThrow();
  expect(opened).toBe(0);
});

test("native handoff preserves BOM/CRLF and reports the actual opened path; failed opens never complete falsely", async () => {
  const f = await fixture(), original = f.resource.files.find(file => file.path.endsWith(".cif") && new TextDecoder().decode(file.data).includes("\r\n"))!, bom = new Uint8Array([239, 187, 191, ...original.data]);
  const store = { getInstalled: async () => ({ ...f.resource, files: [{ ...original, data: bom }] }) };
  let received = "";
  const native = { ...f.actions, openStructureRecords: async (records: { text: string }[]) => { received = records[0].text; return [{ path: "/native-cache/actual.cif" } as ViewerDocument]; } };
  expect(await openInstalledCrystal(request(original.path), native, { store, platform: "native" })).toBe("/native-cache/actual.cif");
  expect(new TextEncoder().encode(received)).toEqual(bom);
  await expect(openInstalledCrystal(request(original.path), f.actions, { store, platform: "native" })).rejects.toThrow();
  await expect(openInstalledCrystal(request(original.path), { ...f.actions, openPaths: async () => { throw new Error("viewer failed"); } }, { store: f.store, platform: "browser" })).rejects.toThrow();
  const invalid = { getInstalled: async () => ({ ...f.resource, files: [{ ...original, data: new Uint8Array([255]) }] }) };
  await expect(openInstalledCrystal(request(original.path), native, { store: invalid, platform: "native" })).rejects.toThrow();
});

import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
const browser = new Window({ url: "http://localhost/" });
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), oldDatabase = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
const factory = new IDBFactory();
Object.defineProperty(globalThis, "window", { value: browser, configurable: true });
Object.defineProperty(globalThis, "indexedDB", { value: factory, configurable: true });
afterAll(async () => {
  await browser.happyDOM.close();
  if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
  if (oldDatabase) Object.defineProperty(globalThis, "indexedDB", oldDatabase); else Reflect.deleteProperty(globalThis, "indexedDB");
});
// A real v1 database must survive the additive v2 store migration.
const originalBytes = readFileSync(new URL("./fixtures/quantum/gaussian16-water-raman.fchk", import.meta.url));
await new Promise<void>((resolve, reject) => {
  const request = factory.open("burette-browser-imports", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "path" });
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result, tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put({ path: "/OpenedFiles/water.fchk", name: "water.fchk", kind: "text", file: new Blob([originalBytes]) });
    tx.oncomplete = () => { db.close(); resolve(); };
  };
});
const { readBrowserImport, openBrowserImportDatabase } = await import("../apps/desktop/src/lib/browser-import-storage");
const { browserCheckpointOriginal, browserSourceCheckpointScope, writeBrowserSourceCheckpoint, readBrowserSourceCheckpoint } = await import("../apps/desktop/src/lib/browser-source-checkpoint");
const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
const { serializeXyz } = await import("../apps/desktop/src/lib/molecular-workbench/xyz");
const path = "/OpenedFiles/water.fchk";
const original = (await browserCheckpointOriginal(path))!;
const science = parseScientificFile("water.fchk", originalBytes.toString());
const text = serializeXyz(science.atoms, "checkpoint");
const first = { ...original, version: 1 as const, id: "session-a:1", revision: 1, baseText: text, text, science };

test("v1 Original survives upgrade; exact scientific revision and typed values survive reload reads", async () => {
  expect(new Uint8Array(await (await readBrowserImport(path))!.file.arrayBuffer())).toEqual(new Uint8Array(originalBytes));
  expect(await writeBrowserSourceCheckpoint(original, null, first, () => true)).toBe(true);
  const saved = await readBrowserSourceCheckpoint(path);
  expect(saved).toEqual(first);
  expect(saved!.science!.modes).toHaveLength(3);
  expect(new Uint8Array(await (await readBrowserImport(path))!.file.arrayBuffer())).toEqual(new Uint8Array(originalBytes));
});

test("CAS ownership rejects old writes/deletes, stale source admission and cross-tab publication", async () => {
  const next = { ...first, id: "session-b:2", revision: 2 };
  expect(await writeBrowserSourceCheckpoint(original, first.id, next, () => true)).toBe(true);
  expect(await writeBrowserSourceCheckpoint(original, first.id, first, () => true)).toBe(false);
  expect(await writeBrowserSourceCheckpoint(original, first.id, null, () => true)).toBe(false);
  let calls = 0;
  expect(await writeBrowserSourceCheckpoint(original, next.id, first, () => ++calls === 1)).toBe(false);
  const scope = browserSourceCheckpointScope()!;
  browser.sessionStorage.setItem("burette.browser-source-session", "other-tab");
  expect(await readBrowserSourceCheckpoint(path)).toBeNull();
  expect(await writeBrowserSourceCheckpoint(original, next.id, first, () => true)).toBe(false);
  browser.sessionStorage.setItem("burette.browser-source-session", scope);
  expect((await readBrowserSourceCheckpoint(path))!.id).toBe(next.id);
  expect(await writeBrowserSourceCheckpoint(original, next.id, null, () => true)).toBe(true);
  expect(await readBrowserSourceCheckpoint(path)).toBeNull();
});

test("internal coordinate variables and dummy references survive as the exact validated edited revision", async () => {
  const zmat = parseScientificFile("water.zmat", "O\nX 1 1\nH 1 R 2 A\nH 1 R 2 A 3 180\n\nR = 1.1\nA = 52.26\n");
  const edited = { ...first, id: "session-z:3", revision: 3, text: serializeXyz(zmat.atoms, "internal edit"), science: zmat };
  expect(await writeBrowserSourceCheckpoint(original, null, edited, () => true)).toBe(true);
  expect((await readBrowserSourceCheckpoint(path))!.science!.internalCoordinates).toEqual(zmat.internalCoordinates);
  expect(await writeBrowserSourceCheckpoint(original, edited.id, null, () => true)).toBe(true);
});

test("bounds and mismatched scientific geometry reject without replacing the previous checkpoint", async () => {
  await writeBrowserSourceCheckpoint(original, null, first, () => true);
  await expect(writeBrowserSourceCheckpoint(original, first.id, { ...first, text: "x".repeat(3_000_001) }, () => true)).rejects.toThrow();
  const bad = structuredClone(first); bad.science.atoms[0].x += 1;
  await expect(writeBrowserSourceCheckpoint(original, first.id, bad, () => true)).rejects.toThrow();
  expect(await readBrowserSourceCheckpoint(path)).toEqual(first);
  expect(await browserCheckpointOriginal("/private/unknown.fchk")).toBeNull();
  const db = await openBrowserImportDatabase();
  await new Promise<void>((resolve) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put({ path, name: "water.fchk", kind: "text", file: new Blob([new Uint8Array(originalBytes.length)]) });
    tx.oncomplete = () => resolve();
  });
  await expect(readBrowserSourceCheckpoint(path)).rejects.toThrow();
});

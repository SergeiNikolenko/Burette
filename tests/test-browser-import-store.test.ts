import { afterEach, beforeEach, expect, test } from "bun:test";
import { IDBFactory, IDBObjectStore, forceCloseDatabase as forceCloseDatabaseRuntime } from "fake-indexeddb";
// fake-indexeddb 6.2.6 types declare a constructor; its runtime closes a live database instance.
const forceCloseDatabase = forceCloseDatabaseRuntime as unknown as (database: IDBDatabase) => void;
import type { BrowserImport } from "../apps/desktop/src/lib/browser-import-storage";

type Store = typeof import("../apps/desktop/src/lib/browser-import-storage");
let factory: IDBFactory, previous: PropertyDescriptor | undefined, sequence = 0;
beforeEach(() => {
  previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  factory = new IDBFactory();
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: factory });
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase("burette-browser-imports");
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  if (previous) Object.defineProperty(globalThis, "indexedDB", previous); else Reflect.deleteProperty(globalThis, "indexedDB");
});
// Separate module instances model independently cached connections in two browser tabs.
const tab = (): Promise<Store> => import(`../apps/desktop/src/lib/browser-import-storage.ts?store-test=${sequence++}`);
const record = (path = "/OpenedFiles/structure.cif", file = new Blob([new Uint8Array([239, 187, 191, 65, 13, 10, 0, 255])])): BrowserImport => ({
  path, name: path.split("/").at(-1)!, kind: "binary", file, scientific: true,
});
async function seed(values: BrowserImport[]) {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open("burette-browser-imports");
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("files", "readwrite");
      for (const value of values) tx.objectStore("files").put(value);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
}
const metadata = ({ path, name, kind, scientific, file }: BrowserImport) => ({ path, name, kind, scientific, bytes: file.size, type: file.type });

test("independent connections allocate collisions atomically and reopen exact original bytes and metadata", async () => {
  const first = await tab(), second = await tab(), source = record("/OpenedFiles/sample.cif.gz");
  const copies = await Promise.all([first.saveBrowserImport(source, [source.path]), second.saveBrowserImport(source), first.saveBrowserImport(source)]);
  expect(new Set(copies.map(copy => copy.path)).size).toBe(3);
  expect(copies.map(copy => copy.path).sort()).toEqual([source.path, "/OpenedFiles/sample (2).cif.gz", "/OpenedFiles/sample (3).cif.gz"].sort());
  const reopened = await tab(), restored = await reopened.listBrowserImports();
  expect(restored.map(metadata).sort((a, b) => a.path.localeCompare(b.path))).toEqual(copies.map(metadata).sort((a, b) => a.path.localeCompare(b.path)));
  for (const copy of copies) expect(await (await reopened.readBrowserImport(copy.path))!.file.arrayBuffer()).toEqual(await source.file.arrayBuffer());
  expect(await reopened.readBrowserImport("/missing.cif")).toBeNull();
});

test("the saved input is a snapshot even when the caller changes its record before storage opens", async () => {
  const store = await tab(), input = record(), original = { ...input };
  const saving = store.saveBrowserImport(input);
  input.path = "/OpenedFiles/changed.cif"; input.name = "changed.cif"; input.file = new Blob(["changed"]); input.scientific = false;
  expect(metadata(await saving)).toEqual(metadata(original));
  expect(await (await store.readBrowserImport(original.path))!.file.arrayBuffer()).toEqual(await original.file.arrayBuffer());
});

test("invalid input and the 24 MiB file limit reject without changing existing imports", async () => {
  const store = await tab(), original = await store.saveBrowserImport(record());
  const invalid = [record("relative.cif"), record("/OpenedFiles/../escape.cif"), record("/OpenedFiles/a\0.cif"),
    { ...record(), name: "x".repeat(256) }, { ...record(), kind: "executable" }, { ...record(), scientific: "yes" }];
  for (const value of invalid) await expect(store.saveBrowserImport(value as BrowserImport)).rejects.toThrow("invalid name");
  const max = new Blob([new Uint8Array(store.BROWSER_IMPORT_MAX_FILE_BYTES)]);
  await store.saveBrowserImport(record("/OpenedFiles/at-limit.bin", max));
  await expect(store.saveBrowserImport(record("/OpenedFiles/oversize.bin", new Blob([max, "x"])))).rejects.toThrow("24 MiB");
  expect((await store.listBrowserImports()).map(value => value.path).sort()).toEqual([original.path, "/OpenedFiles/at-limit.bin"].sort());
  expect(await (await store.readBrowserImport(original.path))!.file.arrayBuffer()).toEqual(await original.file.arrayBuffer());
});

test("count and total-byte bounds preserve every existing original without eviction", async () => {
  const store = await tab(); await store.listBrowserImports();
  const chunk = new Blob([new Uint8Array(24 * 1024 * 1024)]);
  await seed(Array.from({ length: 5 }, (_, i) => record(`/OpenedFiles/large-${i}.bin`, chunk)));
  await store.saveBrowserImport(record("/OpenedFiles/remainder.bin", new Blob([new Uint8Array(8 * 1024 * 1024)])));
  await expect(store.saveBrowserImport(record("/OpenedFiles/one-more.bin", new Blob(["x"])))).rejects.toThrow("storage is full");
  expect((await store.listBrowserImports()).length).toBe(6);
  for (let i = 0; i < 5; i++) expect((await store.readBrowserImport(`/OpenedFiles/large-${i}.bin`))!.file.size).toBe(chunk.size);
  await seed(Array.from({ length: 250 }, (_, i) => record(`/OpenedFiles/small-${i}.bin`, new Blob())));
  await expect(store.saveBrowserImport(record("/OpenedFiles/overflow.bin", new Blob()))).rejects.toThrow("storage is full");
  expect((await store.listBrowserImports()).length).toBe(256);
});

test("quota errors and an abort after add success never publish a path; retry reuses the free suffix", async () => {
  const store = await tab(), original = await store.saveBrowserImport(record()), add = IDBObjectStore.prototype.add;
  try {
    IDBObjectStore.prototype.add = function () { throw new DOMException("device details", "QuotaExceededError"); };
    await expect(store.saveBrowserImport(original)).rejects.toThrow("Check available site storage");
    IDBObjectStore.prototype.add = function (...args: Parameters<typeof add>) {
      const request = add.apply(this, args);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    };
    await expect(store.saveBrowserImport(original)).rejects.toThrow("Check available site storage");
  } finally { IDBObjectStore.prototype.add = add; }
  expect((await store.listBrowserImports()).map(value => value.path)).toEqual([original.path]);
  expect((await store.saveBrowserImport(original)).path).toBe("/OpenedFiles/structure (2).cif");
  expect(await (await store.readBrowserImport(original.path))!.file.arrayBuffer()).toEqual(await original.file.arrayBuffer());
});

test("corrupt persisted metadata rejects restoration and writes instead of hiding or evicting files", async () => {
  const store = await tab(), original = await store.saveBrowserImport(record());
  await seed([{ ...record("/OpenedFiles/broken.cif"), file: "not a Blob" } as unknown as BrowserImport]);
  await expect(store.readBrowserImport("/OpenedFiles/broken.cif")).rejects.toThrow("could not be restored");
  await expect(store.listBrowserImports()).rejects.toThrow("could not be restored");
  await expect(store.saveBrowserImport(record("/OpenedFiles/new.cif"))).rejects.toThrow("could not be restored");
  expect(await (await store.readBrowserImport(original.path))!.file.arrayBuffer()).toEqual(await original.file.arrayBuffer());
});

test("an unavailable opening can be retried once IndexedDB becomes available", async () => {
  const store = await tab();
  Reflect.deleteProperty(globalThis, "indexedDB");
  expect(await store.readBrowserImport("/native/source.cif")).toBeNull();
  await expect(store.saveBrowserImport(record())).rejects.toThrow("Check available site storage");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: factory });
  const saved = await store.saveBrowserImport(record());
  expect(metadata((await store.readBrowserImport(saved.path))!)).toEqual(metadata(saved));
});

test("an abnormal connection close reopens for reads and writes without losing original bytes", async () => {
  const opened: IDBDatabase[] = [], open = factory.open.bind(factory);
  factory.open = (...args: Parameters<typeof open>) => {
    const request = open(...args);
    request.addEventListener("success", () => opened.push(request.result));
    return request;
  };
  const store = await tab(), original = await store.saveBrowserImport(record());
  expect(opened.length).toBe(1);
  await new Promise<void>(resolve => {
    opened[0].addEventListener("close", () => resolve(), { once: true });
    forceCloseDatabase(opened[0]);
  });
  const restored = await store.readBrowserImport(original.path);
  expect(metadata(restored!)).toEqual(metadata(original));
  expect(await restored!.file.arrayBuffer()).toEqual(await original.file.arrayBuffer());
  expect((await store.saveBrowserImport(original)).path).toBe("/OpenedFiles/structure (2).cif");
  expect(opened.length).toBe(2);
  expect((await store.listBrowserImports()).map(value => value.path)).toEqual(["/OpenedFiles/structure (2).cif", original.path]);
});

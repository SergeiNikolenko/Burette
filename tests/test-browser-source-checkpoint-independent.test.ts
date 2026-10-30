import { afterAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { IDBFactory } from "fake-indexeddb";
import type { BrowserSourceCheckpoint } from "../apps/desktop/src/lib/browser-source-checkpoint";
const browser = new Window({ url: "http://localhost/" });
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, indexedDB: new IDBFactory() })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { value, configurable: true });
}
afterAll(async () => {
  await browser.happyDOM.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
const { openBrowserImportDatabase, saveBrowserImport, readBrowserImport } = await import("../apps/desktop/src/lib/browser-import-storage");
const { browserCheckpointOriginal, writeBrowserSourceCheckpoint, readBrowserSourceCheckpoint } = await import("../apps/desktop/src/lib/browser-source-checkpoint");
async function transaction(run: (tx: IDBTransaction) => void) {
  const db = await openBrowserImportDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["files", "source-checkpoints"], "readwrite");
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    run(tx);
  });
}
beforeEach(() => transaction(tx => { tx.objectStore("files").clear(); tx.objectStore("source-checkpoints").clear(); }));
async function seed(path: string, value = "Original") {
  await saveBrowserImport({ path, name: "same.xyz", kind: "text", file: new Blob([value]) });
  const original = (await browserCheckpointOriginal(path))!;
  const first: BrowserSourceCheckpoint = { ...original, version: 1, id: `${path}:first`, revision: 1, baseText: "base", text: "first", science: null };
  return { original, first };
}

test("independent: two real concurrent CAS writers admit one winner and reject delayed discard", async () => {
  const { original, first } = await seed("/cas.xyz");
  expect(await writeBrowserSourceCheckpoint(original, null, first, () => true)).toBe(true);
  const a = { ...first, id: "a:2", revision: 2, text: "A" }, b = { ...first, id: "b:2", revision: 2, text: "B" };
  const results = await Promise.all([writeBrowserSourceCheckpoint(original, first.id, a, () => true), writeBrowserSourceCheckpoint(original, first.id, b, () => true)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const winner = results[0] ? a : b;
  expect(await readBrowserSourceCheckpoint(original.path)).toEqual(winner);
  expect(await writeBrowserSourceCheckpoint(original, first.id, null, () => true)).toBe(false);
  expect(await readBrowserSourceCheckpoint(original.path)).toEqual(winner);
});

test("independent: mutating a caller target after invocation must not bypass another path CAS", async () => {
  const { original, first } = await seed("/a.xyz", "Original-A");
  await seed("/b.xyz", "Original-B");
  expect(await writeBrowserSourceCheckpoint(original, null, first, () => true)).toBe(true);
  const target = { scope: original.scope, path: original.path };
  const next = { ...first, id: "unowned:2", revision: 2, text: "wrong successor" };
  const pending = writeBrowserSourceCheckpoint(target, null, next, () => true);
  target.path = "/b.xyz";
  const applied = await pending;
  const checkpointA = await readBrowserSourceCheckpoint(original.path), checkpointB = await readBrowserSourceCheckpoint("/b.xyz");
  expect({ applied, checkpointA, checkpointB }).toEqual({ applied: false, checkpointA: first, checkpointB: null });
});

test("independent: input snapshot and UTF8 bound preserve the last durable checkpoint", async () => {
  const { original, first } = await seed("/snapshot.xyz");
  const pending = writeBrowserSourceCheckpoint(original, null, first, () => true);
  const mutable = first as { text: string };
  mutable.text = "mutated after invocation";
  expect(await pending).toBe(true);
  expect((await readBrowserSourceCheckpoint(original.path))!.text).toBe("first");
  await expect(writeBrowserSourceCheckpoint(original, first.id, { ...first, text: "水".repeat(1_000_001) }, () => true)).rejects.toThrow();
  expect((await readBrowserSourceCheckpoint(original.path))!.text).toBe("first");
});

test("independent: aggregate capacity failure is atomic and corrupted Original cannot be adopted", async () => {
  for (let index = 0; index < 5; index++) {
    const { original, first } = await seed(`/budget-${index}.xyz`);
    expect(await writeBrowserSourceCheckpoint(original, null, { ...first, text: "a".repeat(2_900_000), baseText: "b".repeat(2_900_000) }, () => true)).toBe(true);
  }
  const { original, first } = await seed("/over-budget.xyz");
  await expect(writeBrowserSourceCheckpoint(original, null, { ...first, text: "a".repeat(2_900_000), baseText: "b".repeat(2_900_000) }, () => true)).rejects.toThrow("full");
  expect(await readBrowserSourceCheckpoint(original.path)).toBeNull();
  expect((await readBrowserSourceCheckpoint("/budget-0.xyz"))!.text.length).toBe(2_900_000);
  const imported = (await readBrowserImport("/budget-0.xyz"))!;
  await transaction(tx => tx.objectStore("files").put({ ...imported, file: new Blob(["Corrupt!"]) }));
  await expect(readBrowserSourceCheckpoint("/budget-0.xyz")).rejects.toThrow();
});

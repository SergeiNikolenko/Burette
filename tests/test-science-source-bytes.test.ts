import { afterAll, expect, mock, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { gzipSync } from "node:zlib";
import type { ViewerDocument } from "../apps/desktop/src/types";

const priorDatabase = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"), previousFetch = globalThis.fetch;
const factory = new IDBFactory();
Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: factory });
let native = false, nativeBytes = new Uint8Array(), requests: unknown[] = [];
mock.module("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: { path: string }) => {
  requests.push({ command, args }); return nativeBytes.buffer;
} }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => native }));
const { readSceneDocumentBytes } = await import("../apps/desktop/src/lib/science-session/source-bytes");
const { saveBrowserImport } = await import("../apps/desktop/src/lib/browser-import-storage");
const { writeBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { registerCompressedSource } = await import("../apps/desktop/src/lib/compressed-files/sources");
const { supportedCompressedName } = await import("../apps/desktop/src/lib/compressed-files/formats");
const document = (path: string, byteCount = 0) => ({ id: path, path, byteCount } as ViewerDocument);
afterAll(() => {
  globalThis.fetch = previousFetch;
  if (priorDatabase) Object.defineProperty(globalThis, "indexedDB", priorDatabase); else Reflect.deleteProperty(globalThis, "indexedDB");
});

test("Original uses the immutable persisted Blob before current virtual draft text, retaining BOM and CRLF", async () => {
  const path = "/OpenedFiles/original-source.sdf", bytes = new TextEncoder().encode("\uFEFFsource\r\nexact\r\n");
  await saveBrowserImport({ path, name: "original-source.sdf", kind: "text", file: new Blob([bytes]) });
  writeBrowserDevVirtualTextDocument(path, "changed draft\n");
  expect(await readSceneDocumentBytes(document(path))).toEqual(bytes);
  await expect(readSceneDocumentBytes(document(path), bytes.length - 1)).rejects.toMatchObject({ code: "limit" });
});

test("persisted binary archives keep every byte without a new browser picked-file registry", async () => {
  const bytes = Uint8Array.of(0x50, 0x4b, 0, 255, 13, 10), path = "/OpenedFiles/retained.molx";
  await saveBrowserImport({ path, name: "retained.molx", kind: "binary", file: new Blob([bytes]) });
  expect(await readSceneDocumentBytes(document(path))).toEqual(bytes);
});

test("the existing compressed source owner supplies exact uploaded bytes without decoding", async () => {
  const bytes = gzipSync("source\r\n"), path = "/OpenedFiles/retained.sdf.gz";
  registerCompressedSource(path, "retained.sdf.gz", new Blob([bytes]), supportedCompressedName("retained.sdf.gz"));
  expect(await readSceneDocumentBytes(document(path))).toEqual(new Uint8Array(bytes));
  await expect(readSceneDocumentBytes(document(path), bytes.length - 1)).rejects.toMatchObject({ code: "limit" });
});

test("native reads use the established raw-byte command and check actual payload bounds", async () => {
  native = true; nativeBytes = Uint8Array.of(0xef, 0xbb, 0xbf, 13, 10); requests = [];
  try {
    expect(await readSceneDocumentBytes(document("/native/source.sdf"))).toEqual(nativeBytes);
    expect(requests).toEqual([{ command: "read_document_file", args: { path: "/native/source.sdf" } }]);
    await expect(readSceneDocumentBytes(document("/native/source.sdf"), 4)).rejects.toMatchObject({ code: "limit" });
  } finally { native = false; }
});

test("generated virtual source is UTF-8 encoded and bounded by bytes", async () => {
  const text = "αβ\r\n", path = "burette-ketcher://generated/source.sdf";
  writeBrowserDevVirtualTextDocument(path, text);
  expect(await readSceneDocumentBytes(document(path))).toEqual(new TextEncoder().encode(text));
  await expect(readSceneDocumentBytes(document(path), text.length)).rejects.toMatchObject({ code: "limit" });
});

test("server streaming enforces observed bytes and cancels the reader on overflow", async () => {
  let cancelled = 0;
  globalThis.fetch = Object.assign(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled++; },
  })), { preconnect: previousFetch.preconnect });
  await expect(readSceneDocumentBytes(document("https://server.invalid/source.molx"), 10)).rejects.toMatchObject({ code: "limit" });
  expect(cancelled).toBe(1);
  globalThis.fetch = Object.assign(async () => new Response(null, { status: 403 }), { preconnect: previousFetch.preconnect });
  await expect(readSceneDocumentBytes(document("https://server.invalid/source.molx"))).rejects.toMatchObject({ code: "archive" });
});

test("a corrupt persisted original cannot be hidden by a virtual draft or HTTP fallback", async () => {
  const path = "/OpenedFiles/corrupt-original.sdf";
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("burette-browser-imports", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite"); tx.objectStore("files").put({ path, name: "corrupt-original.sdf", kind: "text", file: "not a Blob" });
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  db.close(); writeBrowserDevVirtualTextDocument(path, "current draft");
  let fetched = false; globalThis.fetch = Object.assign(async () => { fetched = true; return new Response("wrong original"); }, { preconnect: previousFetch.preconnect });
  await expect(readSceneDocumentBytes(document(path))).rejects.toThrow("could not be restored");
  expect(fetched).toBe(false);
});

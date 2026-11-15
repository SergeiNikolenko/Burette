import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { IDBFactory } from "fake-indexeddb";
import type { BrowserSourceCheckpoint } from "../apps/desktop/src/lib/browser-source-checkpoint";
const browser = new Window({ url: "http://localhost/" }), descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, indexedDB: new IDBFactory() })) {
  descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true });
}
afterAll(async () => { await browser.happyDOM.close(); for (const [key, descriptor] of descriptors) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const { saveBrowserImport, openBrowserImportDatabase } = await import("../apps/desktop/src/lib/browser-import-storage");
const { browserCheckpointOriginal, writeBrowserSourceCheckpoint, readBrowserSourceCheckpoint } = await import("../apps/desktop/src/lib/browser-source-checkpoint");
const { sha256Hex } = await import("../apps/desktop/src/lib/source-editing/source-identity");
const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
const { serializeXyz } = await import("../apps/desktop/src/lib/molecular-workbench/xyz");
async function fixture(name: string, file = new Blob(["10000 -2.25 .12\r\n"])) {
  const path = `/OpenedFiles/${name}.out`, primary = new File(["primary original\r\n"], `${name}.out`);
  await saveBrowserImport({ path, name: primary.name, kind: "text", file: primary });
  const original = (await browserCheckpointOriginal(path))!, science = parseScientificFile("water.xyz", "3\nwater\nO 0 0 0\nH 1 0 0\nH 0 1 0\n");
  const text = serializeXyz(science.atoms, "source geometry");
  const hashes = { primaryOriginalSha256: original.originalSha256, companionOriginalSha256: await sha256Hex(new Uint8Array(await file.arrayBuffer())), sourceRevisionSha256: await sha256Hex(text) };
  science.frames[0].mcdCompanion = { ...hashes, spectra: { kind: "scientific-spectra", version: 1,
    source: { name: "explicit.mcd", format: "orca-mcd", scope: "frame", frameIndex: 0, frameCount: 1 }, atomicNumbers: [8, 1, 1],
    spectra: [{ kind: "mcd", xUnit: "cm^-1", positions: [10000], values: [-2.25], valueUnit: null, auxiliary: [{ name: "absorption", unit: null, values: [.12] }] }] } };
  const checkpoint: BrowserSourceCheckpoint = { ...original, version: 2, id: `${name}:1`, revision: 1, baseText: text, text, science,
    companions: [{ role: "orca-mcd", frameIndex: 0, frameCount: 1, name: "explicit.mcd", file, ...hashes }] };
  return { original, checkpoint, path };
}
async function clear() {
  const db = await openBrowserImportDatabase();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction("source-checkpoints", "readwrite"); tx.objectStore("source-checkpoints").clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}

test("paired source bytes and data survive v2 reads; malformed, missing, stale and replaced bindings preserve prior record", async () => {
  await clear(); const { original, checkpoint, path } = await fixture("paired");
  expect(await writeBrowserSourceCheckpoint(original, null, checkpoint, () => true)).toBe(true);
  const saved = (await readBrowserSourceCheckpoint(path))!;
  expect(saved.science).toEqual(checkpoint.science);
  expect(new Uint8Array(await saved.companions![0].file.arrayBuffer())).toEqual(new Uint8Array(await checkpoint.companions![0].file.arrayBuffer()));
  const malformed = [
    { ...checkpoint, version: 1, companions: undefined },
    { ...checkpoint, companions: [] },
    { ...checkpoint, companions: [{ ...checkpoint.companions![0], extraBinary: new Blob([new Uint8Array(17 * 1024 * 1024)]) }] },
    { ...checkpoint, companions: [{ ...checkpoint.companions![0], role: "foreign" }] },
    { ...checkpoint, companions: [{ ...checkpoint.companions![0], companionOriginalSha256: "a".repeat(64) }] },
    { ...checkpoint, companions: [{ ...checkpoint.companions![0], file: new Blob(["10000 -9.99 .12\r\n"]) }] },
    { ...checkpoint, companions: [{ ...checkpoint.companions![0], sourceRevisionSha256: "b".repeat(64) }] },
    { ...checkpoint, originalBytes: -1 },
  ];
  for (const value of malformed) await expect(writeBrowserSourceCheckpoint(original, checkpoint.id, value as BrowserSourceCheckpoint, () => true)).rejects.toThrow();
  expect((await readBrowserSourceCheckpoint(path))!.id).toBe(checkpoint.id);
  expect(await writeBrowserSourceCheckpoint(original, "stale:0", { ...checkpoint, id: "stale:2" }, () => true)).toBe(false);
  const sameSize = new Blob(["replaced original\n"]);
  expect(sameSize.size).toBe(original.originalBytes);
  const db = await openBrowserImportDatabase();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put({ path, name: original.originalName, kind: "text", file: sameSize });
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  await expect(readBrowserSourceCheckpoint(path)).rejects.toThrow();
});

test("binary bytes count towards record and aggregate budgets, and over-limit record refuses before reading blobs", async () => {
  await clear(); const eleven = new Blob([new Uint8Array(11 * 1024 * 1024)]);
  const first = await fixture("budget-one", eleven), second = await fixture("budget-two", eleven), third = await fixture("budget-three", eleven);
  expect(await writeBrowserSourceCheckpoint(first.original, null, first.checkpoint, () => true)).toBe(true);
  expect(await writeBrowserSourceCheckpoint(second.original, null, second.checkpoint, () => true)).toBe(true);
  await expect(writeBrowserSourceCheckpoint(third.original, null, third.checkpoint, () => true)).rejects.toThrow("full");
  expect(await readBrowserSourceCheckpoint(third.path)).toBeNull();
  expect((await readBrowserSourceCheckpoint(first.path))!.id).toBe(first.checkpoint.id);
  const oversized = { ...first.checkpoint, companions: [{ ...first.checkpoint.companions![0], file: new Blob([new Uint8Array(16 * 1024 * 1024)]) }] };
  const originalRead = Blob.prototype.arrayBuffer; let reads = 0;
  Blob.prototype.arrayBuffer = async function () { reads++; return originalRead.call(this); };
  try { await expect(writeBrowserSourceCheckpoint(first.original, first.checkpoint.id, oversized, () => true)).rejects.toThrow(); expect(reads).toBe(0); }
  finally { Blob.prototype.arrayBuffer = originalRead; }
});

test("companion hashing cannot publish after its source owner retires", async () => {
  await clear(); const { original, checkpoint, path } = await fixture("retired");
  expect(await writeBrowserSourceCheckpoint(original, null, checkpoint, () => true)).toBe(true);
  const originalRead = Blob.prototype.arrayBuffer; let current = true;
  Blob.prototype.arrayBuffer = async function () { const bytes = await originalRead.call(this); if (this.size === checkpoint.companions![0].file.size) current = false; return bytes; };
  try { expect(await writeBrowserSourceCheckpoint(original, checkpoint.id, { ...checkpoint, id: "retired:2" }, () => current)).toBe(false); }
  finally { Blob.prototype.arrayBuffer = originalRead; }
  expect((await readBrowserSourceCheckpoint(path))!.id).toBe(checkpoint.id);
});

test("known scientific array views become dense and hidden scientific binary metadata is rejected", async () => {
  await clear(); const { original, checkpoint, path } = await fixture("scientific-binary");
  const gridBuffer = new Float32Array(17 * 1024 * 1024 / 4); gridBuffer[3] = 2.5;
  const hessianBuffer = new Float64Array(17 * 1024 * 1024 / 8), values = hessianBuffer.subarray(5, 86);
  for (let i = 0; i < 9; i++) values[i * 9 + i] = i + 1;
  checkpoint.science!.grid = { dimensions: [1, 1, 1], origin: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], values: gridBuffer.subarray(3, 4) };
  checkpoint.science!.frames[0].hessian = { values, dimension: 9, units: "hartree/bohr^2", source: "gaussian-fchk" };
  expect(await writeBrowserSourceCheckpoint(original, null, checkpoint, () => true)).toBe(true);
  const recovered = (await readBrowserSourceCheckpoint(path))!.science!;
  expect([Array.from(recovered.grid!.values), Array.from(recovered.frames[0].hessian!.values)]).toEqual([[2.5], Array.from(values)]);
  expect([recovered.grid!.values.buffer.byteLength, recovered.frames[0].hessian!.values.buffer.byteLength]).toEqual([4, 648]);
  expect([gridBuffer.byteLength, hessianBuffer.byteLength]).toEqual([17 * 1024 * 1024, 17 * 1024 * 1024]);
  await expect(writeBrowserSourceCheckpoint(original, checkpoint.id, { ...checkpoint,
    science: { ...checkpoint.science!, extraBinary: new Blob([new Uint8Array(17 * 1024 * 1024)]) } } as BrowserSourceCheckpoint, () => true)).rejects.toThrow();
  expect((await readBrowserSourceCheckpoint(path))!.id).toBe(checkpoint.id);
});

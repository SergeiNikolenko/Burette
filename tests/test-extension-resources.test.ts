import { expect, spyOn, test } from "bun:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { CRYSTALS_RESOURCE, verifyResourceBundle, type ResourceCatalogEntry } from "../apps/desktop/src/lib/extensions/resource-bundle";
import { createResourceStore } from "../apps/desktop/src/lib/extensions/resource-store";
const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { gzipSync } = require("fflate");
const real = new Uint8Array(readFileSync(new URL("../resources/extensions/openchemistry-crystals.bin", import.meta.url)));
const corpus = JSON.parse(gunzipSync(real).toString());
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fixture(version = "v1", mutate: (document: typeof corpus) => void = () => {}) {
  const document = structuredClone(corpus);
  document.files = document.files.filter((file: { path: string }) => ["README.md", "plugin.json", "antimonides/AlSb.cif"].includes(file.path));
  mutate(document);
  const bytes = new Uint8Array(gzipSync(new TextEncoder().encode(JSON.stringify(document)), { mtime: 0 }));
  const entry: ResourceCatalogEntry = { ...structuredClone(CRYSTALS_RESOURCE), version, compressed: { bytes: bytes.length, sha256: sha(bytes) },
    corpus: { cifCount: 1, cifBytes: Buffer.from(document.files.find((file: { path: string }) => file.path.endsWith(".cif"))?.dataBase64 ?? "", "base64").length } };
  return { bytes, entry };
}
function gateDigest() {
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void, entered!: () => void, first = true;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const spy = spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
    if (first) { first = false; entered(); await wait; }
    return digest(...args);
  });
  return { reached, release, restore: () => spy.mockRestore() };
}
async function recordCount(factory: IDBFactory, store = "versions") {
  return new Promise<number>((resolve, reject) => {
    const request = factory.open("burette-extension-resources", 1);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(store), count = tx.objectStore(store).count();
      tx.oncomplete = () => { db.close(); resolve(count.result); };
      tx.onabort = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

test("actual reviewed bundle verifies and reopens exact CIF bytes through a separate IDB connection", async () => {
  const factory = new IDBFactory(), store = createResourceStore(factory);
  const verified = await store.install(CRYSTALS_RESOURCE, real);
  expect(verified.files.length).toBe(526);
  const restored = await createResourceStore(factory).getInstalled(CRYSTALS_RESOURCE.id);
  expect(restored).toEqual(verified);
  const cif = restored!.files.find(file => file.path === "antimonides/AlSb.cif");
  expect(cif).toBeDefined();
  const original = corpus.files.find((file: { path: string }) => file.path === cif!.path);
  expect(cif!.data).toEqual(new Uint8Array(Buffer.from(original.dataBase64, "base64")));
  expect(sha(cif!.data)).toBe(original.sha256);
});

test("bundle verifier rejects hashes, unsafe paths, executable entries, malformed attribution and bounds", async () => {
  const good = fixture();
  await expect(verifyResourceBundle({ ...good.entry, compressed: { ...good.entry.compressed, sha256: "0".repeat(64) } }, good.bytes)).rejects.toThrow();
  for (const mutate of [
    (doc: typeof corpus) => { doc.files[1].path = "../escape.cif"; },
    (doc: typeof corpus) => { doc.files[1].path = "/absolute.cif"; },
    (doc: typeof corpus) => { doc.files[1].path = "run.js"; },
    (doc: typeof corpus) => { doc.files[1].path = doc.files[0].path; },
    (doc: typeof corpus) => { doc.files[1].sha256 = "0".repeat(64); },
    (doc: typeof corpus) => { doc.files[1].bytes = 32769; },
    (doc: typeof corpus) => { doc.files = doc.files.slice(1); },
    (doc: typeof corpus) => { doc.source.commit = "0".repeat(40); },
    (doc: typeof corpus) => { const file = doc.files.find((file: { path: string }) => file.path === "plugin.json"); const bytes = Buffer.from('{"type":"commands"}'); file.bytes = bytes.length; file.sha256 = sha(bytes); file.dataBase64 = bytes.toString("base64"); },
    (doc: typeof corpus) => { const file = doc.files.find((file: { path: string }) => file.path === "plugin.json"); const bytes = Buffer.from('{"type":"data"}'); file.bytes = bytes.length; file.sha256 = sha(bytes); file.dataBase64 = bytes.toString("base64"); },
  ]) {
    const bad = fixture("v1", mutate);
    await expect(verifyResourceBundle(bad.entry, bad.bytes)).rejects.toThrow();
  }
  const truncated = good.bytes.slice(0, -4);
  await expect(verifyResourceBundle({ ...good.entry, compressed: { bytes: truncated.length, sha256: sha(truncated) } }, truncated)).rejects.toThrow();
  const bomb = new Uint8Array(gzipSync(new Uint8Array(8 * 1024 * 1024 + 1), { mtime: 0 }));
  await expect(verifyResourceBundle({ ...good.entry, compressed: { bytes: bomb.length, sha256: sha(bomb) } }, bomb)).rejects.toThrow();
  new DataView(bomb.buffer).setUint32(bomb.length - 4, 0, true); // Declared size cannot bypass streaming bounds.
  await expect(verifyResourceBundle({ ...good.entry, compressed: { bytes: bomb.length, sha256: sha(bomb) } }, bomb)).rejects.toThrow();
});

test("failed staging never appears installed; retry uses immutable copies of caller input", async () => {
  const factory = new IDBFactory(), store = createResourceStore(factory), good = fixture();
  await expect(store.install({ ...good.entry, compressed: { ...good.entry.compressed, sha256: "0".repeat(64) } }, good.bytes)).rejects.toThrow();
  expect(await store.getInstalled(good.entry.id)).toBeNull();
  expect(await recordCount(factory)).toBe(0);
  const input = good.bytes.slice(), entry = structuredClone(good.entry), pending = store.install(entry, input);
  input.fill(0); entry.version = "changed";
  await pending;
  expect((await store.getInstalled(good.entry.id))!.catalog.version).toBe("v1");
});

for (const fault of ["quota", "abort", "cancel"]) test(`${fault} at publication preserves prior version and permits retry`, async () => {
  const factory = new IDBFactory(), store = createResourceStore(factory), first = fixture(), second = fixture("v2"), controller = new AbortController();
  const previous = await store.install(first.entry, first.bytes);
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === "versions" && fault === "quota") throw new DOMException("Quota reached", "QuotaExceededError");
    const request = put.apply(this, args);
    if (this.name === "versions") {
      if (fault === "abort") this.transaction.abort();
      if (fault === "cancel") controller.abort();
    }
    return request;
  };
  try { await expect(store.install(second.entry, second.bytes, controller.signal)).rejects.toThrow(); }
  finally { IDBObjectStore.prototype.put = put; }
  expect(await store.getInstalled(first.entry.id)).toEqual(previous);
  expect(await recordCount(factory)).toBe(1);
  expect(await recordCount(factory, "receipts")).toBe(1);
  expect(await recordCount(factory, "intents")).toBe(0);
  await store.install(second.entry, second.bytes);
  expect((await createResourceStore(factory).getInstalled(first.entry.id))!.catalog.version).toBe("v2");
  controller.abort();
  expect((await store.getInstalled(first.entry.id))!.catalog.version).toBe("v2");
});

test("late cancellation cannot revoke a committed installation", async () => {
  const store = createResourceStore(new IDBFactory()), controller = new AbortController(), good = fixture();
  await store.install(good.entry, good.bytes, controller.signal); controller.abort();
  expect((await store.getInstalled(good.entry.id))!.catalog.version).toBe("v1");
});

test("absent removals and failed hashes reclaim identities before a real Crystals installation", async () => {
  const factory = new IDBFactory(), store = createResourceStore(factory);
  for (let i = 0; i < 40; i++) {
    await store.remove(`unused-${i}`);
    await expect(store.install({ ...CRYSTALS_RESOURCE, id: `failed-${i}`, compressed: { bytes: real.length, sha256: "0".repeat(64) } }, real)).rejects.toThrow();
  }
  for (const name of ["resources", "versions", "intents", "receipts"]) expect(await recordCount(factory, name)).toBe(0);
  await createResourceStore(factory).install(CRYSTALS_RESOURCE, real);
  expect((await store.getInstalled(CRYSTALS_RESOURCE.id))!.files.length).toBe(526);
});

test("live intent capacity is bounded and cancellation reclaims all slots", async () => {
  const factory = new IDBFactory(), store = createResourceStore(factory), good = fixture(), controller = new AbortController();
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void, reached!: () => void, entered = 0;
  const wait = new Promise<void>(resolve => { release = resolve; }), full = new Promise<void>(resolve => { reached = resolve; });
  const spy = spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
    if (++entered === 32) reached();
    await wait; return digest(...args);
  });
  const pending = Array.from({ length: 32 }, (_, i) => store.install({ ...good.entry, id: `active-${i}` }, good.bytes, controller.signal).then(() => false, () => true));
  try {
    await full;
    await expect(createResourceStore(factory).install(good.entry, good.bytes)).rejects.toThrow("resource limit");
    expect(await recordCount(factory, "intents")).toBe(32);
    controller.abort(); release(); expect((await Promise.all(pending)).every(Boolean)).toBe(true);
  } finally { controller.abort(); release(); spy.mockRestore(); await Promise.all(pending); }
  expect(await recordCount(factory, "intents")).toBe(0);
  await store.install(good.entry, good.bytes);
  expect((await store.getInstalled(good.entry.id))!.catalog.version).toBe("v1");
});

test("failed old verification cannot reclaim a newer connection's active intent", async () => {
  const factory = new IDBFactory(), first = createResourceStore(factory), second = createResourceStore(factory), good = fixture();
  const digest = crypto.subtle.digest.bind(crypto.subtle), releases: (() => void)[] = [], reached: (() => void)[] = [];
  const waits = [0, 1].map(i => new Promise<void>(resolve => { releases[i] = resolve; }));
  const gates = [0, 1].map(i => new Promise<void>(resolve => { reached[i] = resolve; })); let calls = 0;
  const spy = spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
    const i = calls++; if (i < 2) { reached[i](); await waits[i]; } return digest(...args);
  });
  const old = first.install({ ...good.entry, compressed: { ...good.entry.compressed, sha256: "0".repeat(64) } }, good.bytes);
  let newer: Promise<unknown> | undefined;
  try {
    await gates[0]; newer = second.install(good.entry, good.bytes); await gates[1];
    releases[0](); await expect(old).rejects.toThrow();
    expect(await recordCount(factory, "intents")).toBe(1);
    releases[1](); await newer;
  } finally { releases.forEach(release => release()); spy.mockRestore(); await Promise.allSettled([old, newer]); }
  expect((await first.getInstalled(good.entry.id))!.catalog.version).toBe("v1");
});

test("cancellation during hashing or removal preserves the installed pointer and data", async () => {
  const factory = new IDBFactory(), store = createResourceStore(factory), first = fixture(), second = fixture("v2");
  const previous = await store.install(first.entry, first.bytes), controller = new AbortController(), gate = gateDigest();
  const pending = store.install(second.entry, second.bytes, controller.signal);
  try { await gate.reached; controller.abort(); gate.release(); await expect(pending).rejects.toThrow("cancelled"); }
  finally { gate.release(); gate.restore(); }
  expect(await store.getInstalled(first.entry.id)).toEqual(previous);
  const removeController = new AbortController(), erase = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (...args) {
    const request = erase.apply(this, args);
    if (this.name === "resources") removeController.abort();
    return request;
  };
  try { await expect(store.remove(first.entry.id, removeController.signal)).rejects.toThrow("cancelled"); }
  finally { IDBObjectStore.prototype.delete = erase; }
  expect(await store.getInstalled(first.entry.id)).toEqual(previous);
  expect(await recordCount(factory)).toBe(1);
  await store.remove(first.entry.id);
  expect(await store.getInstalled(first.entry.id)).toBeNull();
  expect(await recordCount(factory)).toBe(0);
});

for (const newer of ["install", "remove", "remove-and-install"]) test(`persisted epoch prevents delayed hashing from overwriting a newer ${newer} in another connection`, async () => {
  const factory = new IDBFactory(), oldStore = createResourceStore(factory), newStore = createResourceStore(factory), first = fixture(), second = fixture("v2");
  await oldStore.install(first.entry, first.bytes);
  const gate = gateDigest(), old = oldStore.install(first.entry, first.bytes);
  try {
    await gate.reached;
    if (newer !== "install") await newStore.remove(first.entry.id);
    if (newer !== "remove") await newStore.install(second.entry, second.bytes);
    gate.release();
    await expect(old).rejects.toThrow("newer resource operation");
    expect((await oldStore.getInstalled(first.entry.id))?.catalog.version ?? null).toBe(newer === "remove" ? null : "v2");
    expect(await recordCount(factory)).toBe(newer === "remove" ? 0 : 1);
  } finally { gate.release(); gate.restore(); }
});

test("removal cancels an awaited restored read and immutable version collisions preserve current bytes", async () => {
  const factory = new IDBFactory(), store = createResourceStore(factory), good = fixture();
  await store.install(good.entry, good.bytes);
  const changed = fixture("v1", doc => {
    const file = doc.files.find((file: { path: string }) => file.path.endsWith(".cif")), bytes = Buffer.from(file.dataBase64, "base64");
    const next = Buffer.concat([bytes, Buffer.from("\n# changed\n")]); file.dataBase64 = next.toString("base64"); file.bytes = next.length; file.sha256 = sha(next);
  });
  const second = fixture("v2");
  await store.install(second.entry, second.bytes);
  await expect(store.install(changed.entry, changed.bytes)).rejects.toThrow("immutable resource version");
  expect((await store.getInstalled(good.entry.id))!.catalog.version).toBe("v2");
  await store.remove(good.entry.id);
  await expect(store.install(changed.entry, changed.bytes)).rejects.toThrow("immutable resource version");
  await store.install(good.entry, good.bytes);
  expect(await recordCount(factory, "receipts")).toBe(2);
  const gate = gateDigest(), read = store.getInstalled(good.entry.id);
  try { await gate.reached; await createResourceStore(factory).remove(good.entry.id); gate.release(); await expect(read).rejects.toThrow("newer resource operation"); }
  finally { gate.release(); gate.restore(); }
  expect(await store.getInstalled(good.entry.id)).toBeNull();
});

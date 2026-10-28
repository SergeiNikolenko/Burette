import { checkedResourceCatalog, resourceAbort, verifyResourceBundle, type InstalledResource, type ResourceCatalogEntry } from "./resource-bundle";

type Pointer = { id: string; epoch: number; version?: string };
type Version = { id: string; version: string; catalog: ResourceCatalogEntry; compressed: Uint8Array };
const POINTERS = "resources", VERSIONS = "versions", INTENTS = "intents", CLOCK = "clock", RECEIPTS = "receipts";
const MAX_RESOURCES = 32, MAX_RECEIPTS = 1024;
const unavailable = () => new Error("Resource storage is unavailable. Check site storage and retry.");
const superseded = () => new DOMException("A newer resource operation replaced this one.", "AbortError");
function pointer(value: Pointer | undefined, id: string): Pointer {
  if (value === undefined) return { id, epoch: 0 };
  if (value.id !== id || !Number.isSafeInteger(value.epoch) || value.epoch < 1 || value.epoch >= Number.MAX_SAFE_INTEGER
    || (value.version !== undefined && !/^[a-zA-Z0-9._-]{1,64}$/u.test(value.version))) throw unavailable();
  return value;
}

/** Separate connections share persisted epochs; hashing never holds a transaction open. */
export function createResourceStore(factory: IDBFactory | undefined = globalThis.indexedDB) {
  let database: Promise<IDBDatabase> | undefined;
  function open() {
    return database ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!factory) { reject(unavailable()); return; }
      const request = factory.open("burette-extension-resources", 1);
      let failed = false;
      request.onerror = request.onblocked = () => { failed = true; reject(unavailable()); };
      request.onupgradeneeded = () => {
        request.result.createObjectStore(POINTERS, { keyPath: "id" });
        request.result.createObjectStore(VERSIONS, { keyPath: ["id", "version"] });
        request.result.createObjectStore(INTENTS, { keyPath: "id" });
        request.result.createObjectStore(CLOCK);
        request.result.createObjectStore(RECEIPTS, { keyPath: ["id", "version"] });
      };
      request.onsuccess = () => {
        const db = request.result;
        if (failed) { db.close(); return; }
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
    }).catch(error => { database = undefined; throw error; });
  }
  async function transaction<T>(stores: string[], mode: IDBTransactionMode, signal: AbortSignal | undefined,
    action: (tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void) {
    resourceAbort(signal);
    const db = await open(); resourceAbort(signal);
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode); let result: T, failure: unknown;
      const fail = (error: unknown) => { failure ??= error; try { tx.abort(); } catch { /* A committed/aborted transaction is already settled. */ } };
      const abort = () => fail(new DOMException("Resource operation cancelled.", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      const clean = () => signal?.removeEventListener("abort", abort);
      tx.onabort = () => { clean(); reject(failure ?? tx.error ?? unavailable()); };
      // Publication is acknowledged only on complete; later cancellation cannot revoke it.
      tx.oncomplete = () => { clean(); resolve(result); };
      try { action(tx, value => { result = value; }, fail); } catch (error) { fail(error); }
    });
  }
  function watch<T>(request: IDBRequest<T>, read: (value: T) => void, fail: (error: unknown) => void) {
    request.onsuccess = () => { try { read(request.result); } catch (error) { fail(error); } };
  }
  function id(value: string) { if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(value)) throw unavailable(); return value; }
  function reserve(tx: IDBTransaction, key: string, done: (epoch: number) => void, fail: (error: unknown) => void) {
    const installed = tx.objectStore(POINTERS).getAllKeys(undefined, MAX_RESOURCES + 1);
    const intents = tx.objectStore(INTENTS), active = intents.getAllKeys(undefined, MAX_RESOURCES + 1), clock = tx.objectStore(CLOCK);
    watch(clock.get("epoch"), value => {
      const live = new Set([...installed.result, ...active.result]);
      if ((!live.has(key) && live.size >= MAX_RESOURCES) || live.size > MAX_RESOURCES) throw new Error("Resource storage has reached its resource limit.");
      const previous = value ?? 0;
      if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER - 1) throw unavailable();
      const epoch = previous + 1;
      clock.put(epoch, "epoch"); intents.put({ id: key, epoch }); done(epoch);
    }, fail);
  }
  async function discardIntent(key: string, epoch: number) {
    await transaction<void>([INTENTS], "readwrite", undefined, (tx, done, fail) => {
      const intents = tx.objectStore(INTENTS);
      watch(intents.get(key), value => { if (value?.epoch === epoch) intents.delete(key); done(); }, fail);
    });
  }
  return {
    async install(catalog: ResourceCatalogEntry, provided: Uint8Array, signal?: AbortSignal): Promise<InstalledResource> {
      const entry = checkedResourceCatalog(catalog);
      if (!(provided instanceof Uint8Array) || provided.length !== entry.compressed.bytes) throw unavailable();
      const input = provided.slice();
      const epoch = await transaction<number>([POINTERS, INTENTS, CLOCK], "readwrite", signal, (tx, done, fail) => reserve(tx, entry.id, done, fail));
      try {
        const verified = await verifyResourceBundle(entry, input, signal);
        await transaction<void>([POINTERS, VERSIONS, INTENTS, RECEIPTS], "readwrite", signal, (tx, done, fail) => {
          const pointers = tx.objectStore(POINTERS), versions = tx.objectStore(VERSIONS), intents = tx.objectStore(INTENTS), receipts = tx.objectStore(RECEIPTS);
          const previous = pointers.get(entry.id), receiptCount = receipts.count();
          watch(intents.get(entry.id), intent => {
            if (intent?.epoch !== epoch) throw superseded();
            const row = pointer(previous.result, entry.id);
            watch(receipts.get([entry.id, entry.version]), receipt => {
              if (receipt && JSON.stringify(receipt) !== JSON.stringify(entry)) throw new Error("An immutable resource version already has different content.");
              if (!receipt && receiptCount.result >= MAX_RECEIPTS) throw new Error("Resource version history has reached its limit.");
              if (!receipt) receipts.add(entry);
              versions.put({ id: entry.id, version: entry.version, catalog: entry, compressed: input } satisfies Version);
              if (row.version && row.version !== entry.version) versions.delete([entry.id, row.version]);
              pointers.put({ id: entry.id, epoch, version: entry.version }); intents.delete(entry.id); done();
            }, fail);
          }, fail);
        });
        return verified;
      } catch (error) {
        // Reclaim only our intent, without cancelling a newer operation or altering installed data.
        await discardIntent(entry.id, epoch);
        throw error;
      }
    },
    async remove(resourceId: string, signal?: AbortSignal) {
      const key = id(resourceId);
      await transaction<void>([POINTERS, VERSIONS, INTENTS], "readwrite", signal, (tx, done, fail) => watch(tx.objectStore(POINTERS).get(key), value => {
        const row = pointer(value, key);
        if (row.version) tx.objectStore(VERSIONS).delete([key, row.version]);
        tx.objectStore(POINTERS).delete(key); tx.objectStore(INTENTS).delete(key); done();
      }, fail));
    },
    async getInstalled(resourceId: string, signal?: AbortSignal): Promise<InstalledResource | null> {
      const key = id(resourceId);
      const snapshot = await transaction<{ row: Pointer; value: Version } | null>([POINTERS, VERSIONS], "readonly", signal, (tx, done, fail) => watch(tx.objectStore(POINTERS).get(key), value => {
        const row = pointer(value, key);
        if (!row.version) { done(null); return; }
        watch(tx.objectStore(VERSIONS).get([key, row.version]), version => {
          if (!version || version.id !== key || version.version !== row.version || version.catalog?.id !== key || version.catalog?.version !== row.version || !(version.compressed instanceof Uint8Array)) throw unavailable();
          done({ row, value: version });
        }, fail);
      }, fail));
      if (!snapshot) return null;
      const verified = await verifyResourceBundle(snapshot.value.catalog, snapshot.value.compressed, signal);
      await transaction<void>([POINTERS], "readonly", signal, (tx, done, fail) => watch(tx.objectStore(POINTERS).get(key), value => {
        if (pointer(value, key).epoch !== snapshot.row.epoch) throw superseded();
        done();
      }, fail));
      return verified;
    },
  };
}

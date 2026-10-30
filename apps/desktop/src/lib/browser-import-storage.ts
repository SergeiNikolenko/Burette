/** Original browser imports. Writes finish before files enter the workspace; nothing is evicted. */
export type BrowserImport = {
  path: string;
  name: string;
  kind: "text" | "binary" | "media" | "compressed";
  file: Blob;
  /** Explicit quantum import also accepts otherwise ordinary XYZ trajectories. */
  scientific?: boolean;
};

export const BROWSER_IMPORT_MAX_FILE_BYTES = 24 * 1024 * 1024;
const MAX_FILES = 256;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const STORE = "files";
let database: Promise<IDBDatabase> | undefined;

function storageError() {
  return new Error("Browser file storage is unavailable. Check available site storage and try again.");
}

export function openBrowserImportDatabase() {
  if (database) return database;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(storageError());
      return;
    }
    const request = indexedDB.open("burette-browser-imports", 2);
    let failed = false;
    const fail = () => { failed = true; reject(storageError()); };
    request.onerror = fail;
    request.onblocked = fail;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "path" });
      if (!request.result.objectStoreNames.contains("source-checkpoints")) {
        request.result.createObjectStore("source-checkpoints", { keyPath: ["scope", "path"] });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (failed) { db.close(); return; }
      const invalidate = () => { if (database === pending) database = undefined; };
      db.onclose = invalidate;
      db.onversionchange = () => { db.close(); invalidate(); };
      resolve(db);
    };
  }).catch((error) => { if (database === pending) database = undefined; throw error; });
  database = pending;
  return pending;
}

function validImport(value: unknown): value is BrowserImport {
  if (!value || typeof value !== "object") return false;
  const record = value as BrowserImport;
  return typeof record.path === "string" && record.path.startsWith("/") && record.path.length <= 1024
    && !record.path.split("/").some((part) => part === "." || part === ".." || part.includes("\0"))
    && typeof record.name === "string" && record.name.length <= 255
    && ["text", "binary", "media", "compressed"].includes(record.kind)
    && (record.scientific === undefined || typeof record.scientific === "boolean")
    && record.file instanceof Blob && record.file.size <= BROWSER_IMPORT_MAX_FILE_BYTES;
}

function checkedImports(values: unknown[]): BrowserImport[] {
  if (values.length > MAX_FILES || !values.every(validImport)
    || values.reduce((total, file) => total + file.file.size, 0) > MAX_TOTAL_BYTES) {
    throw new Error("Saved browser files could not be restored. Keep site storage intact and retry.");
  }
  return values;
}

export async function listBrowserImports(): Promise<BrowserImport[]> {
  const db = await openBrowserImportDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll(undefined, MAX_FILES + 1);
    transaction.onabort = () => reject(storageError());
    transaction.onerror = () => reject(storageError());
    transaction.oncomplete = () => {
      try { resolve(checkedImports(request.result)); } catch (error) { reject(error); }
    };
  });
}

export async function readBrowserImport(path: string): Promise<BrowserImport | null> {
  // Reads of server-backed and native files also use the document adapter.
  if (typeof indexedDB === "undefined") return null;
  const db = await openBrowserImportDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(path);
    transaction.onabort = () => reject(storageError());
    transaction.onerror = () => reject(storageError());
    transaction.oncomplete = () => {
      if (request.result === undefined) resolve(null);
      else if (validImport(request.result)) resolve(request.result);
      else reject(new Error("This browser file could not be restored. Keep site storage intact and retry."));
    };
  });
}

/** Atomically allocate a distinct path, so another selection or tab never overwrites an import. */
export async function saveBrowserImport(input: BrowserImport, occupiedPaths: Iterable<string> = []): Promise<BrowserImport> {
  if (!validImport(input)) throw new Error("This file exceeds the 24 MiB browser file limit or has an invalid name.");
  // Blob contents are immutable; capture the selected metadata before awaiting storage.
  input = { ...input };
  const occupied = new Set(occupiedPaths);
  const db = await openBrowserImportDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.getAll(undefined, MAX_FILES + 1);
    let saved: BrowserImport;
    let failure: unknown;
    transaction.onabort = () => reject(failure ?? storageError());
    transaction.onerror = () => reject(failure ?? storageError());
    transaction.oncomplete = () => resolve(saved);
    request.onsuccess = () => {
      try {
        const imports = checkedImports(request.result);
        if (imports.length >= MAX_FILES || imports.reduce((total, record) => total + record.file.size, input.file.size) > MAX_TOTAL_BYTES) {
          throw new Error("Browser workspace storage is full. Save copies before clearing site storage.");
        }
        for (const record of imports) occupied.add(record.path);
        const slash = input.path.lastIndexOf("/") + 1;
        const dot = input.path.indexOf(".", slash + 1);
        const split = dot < 0 ? input.path.length : dot;
        let path = input.path;
        for (let index = 2; occupied.has(path); index++) {
          path = `${input.path.slice(0, split)} (${index})${input.path.slice(split)}`;
        }
        saved = { ...input, path };
        if (!validImport(saved)) throw new Error("This file name is too long for the browser workspace.");
        store.add(saved);
      } catch (error) {
        failure = error instanceof DOMException ? storageError() : error;
        transaction.abort();
      }
    };
  });
}

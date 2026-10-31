import { openBrowserImportDatabase, readBrowserImport } from "./browser-import-storage";
import { isBrowserSessionWorkspace } from "./window-scope";
import type { ScientificDocument } from "./molecular-workbench/scientific-types";
import { scientificDocumentPayload } from "./science-session/codec";
import { SCIENCE_SESSION_LIMITS } from "./science-session/contracts";
import { encodeMcdOriginals, type McdCompanionOriginal } from "./science-session/mcd-originals";
import { readXyzFrames } from "./science-session/source-frames";
import { validateScientificDocument } from "./science-session/scientific-document";

const STORE = "source-checkpoints";
const MAX_RECORDS = 64;
export const BROWSER_SOURCE_CHECKPOINT_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_BYTES = 3_000_000;
const encoder = new TextEncoder();
const scopeKey = "burette.browser-source-session";

/** A source revision, never a renderer receipt, native Undo stack or executable session. */
export type BrowserSourceCheckpoint = Readonly<{
  scope: string; path: string; id: string; revision: number;
  originalSha256: string; originalName: string; originalBytes: number;
  baseText: string; text: string; science: ScientificDocument | null;
} & ({ version: 1; companions?: never } | { version: 2; companions: readonly McdCompanionOriginal[] })>;

export function browserSourceCheckpointScope() {
  if (!isBrowserSessionWorkspace()) return null;
  let scope = window.sessionStorage.getItem(scopeKey);
  if (!scope || !/^[a-zA-Z0-9-]{1,128}$/u.test(scope)) {
    scope = crypto.randomUUID(); window.sessionStorage.setItem(scopeKey, scope);
  }
  return scope;
}

const error = () => new Error("The saved draft could not be read. Keep site storage intact and save a copy of your source.");
const sha256 = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("");

async function checked(value: unknown): Promise<BrowserSourceCheckpoint> {
  if (!value || typeof value !== "object") throw error();
  const item = value as BrowserSourceCheckpoint;
  if ((item.version !== 1 && item.version !== 2) || typeof item.scope !== "string" || !/^[a-zA-Z0-9-]{1,128}$/u.test(item.scope)
    || typeof item.path !== "string" || !item.path.startsWith("/") || item.path.length > 1024
    || item.path.split("/").some(part => part === "." || part === ".." || part.includes("\0"))
    || typeof item.id !== "string" || !item.id || item.id.length > 160
    || !Number.isSafeInteger(item.revision) || item.revision < 0
    || typeof item.originalSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(item.originalSha256)
    || typeof item.originalName !== "string" || item.originalName.length > 255
    || !Number.isSafeInteger(item.originalBytes) || item.originalBytes < 0 || item.originalBytes > 24 * 1024 * 1024
    || typeof item.text !== "string" || typeof item.baseText !== "string"
    || encoder.encode(item.text).byteLength > MAX_TEXT_BYTES || encoder.encode(item.baseText).byteLength > MAX_TEXT_BYTES) throw error();
  if (item.version === 1 ? item.companions !== undefined : !Array.isArray(item.companions) || !item.companions.length
    || item.companions.length > SCIENCE_SESSION_LIMITS.attachments || item.companions.some(entry => !entry || !(entry.file instanceof Blob))) throw error();
  if (item.science !== null) validateScientificDocument(item.science, readXyzFrames(item.text));
  const payload = item.science === null ? null : scientificDocumentPayload(item.science);
  if (recordBytes(item, payload?.byteLength ?? 4) > BROWSER_SOURCE_CHECKPOINT_BYTES) throw error();
  // Snapshot before the first await; only dense visible typed-array values are retained.
  const captured: BrowserSourceCheckpoint = {
    ...(item.version === 2 ? { version: 2 as const, companions: structuredClone(item.companions) } : { version: 1 as const }),
    scope: item.scope, path: item.path, id: item.id, revision: item.revision,
    originalSha256: item.originalSha256, originalName: item.originalName, originalBytes: item.originalBytes,
    baseText: item.baseText, text: item.text, science: payload?.clone() ?? null,
  };
  if (captured.companions || captured.science?.frames.some(frame => frame.mcdCompanion)) {
    let attachment = 0;
    await encodeMcdOriginals(captured.science, captured.companions, captured.originalSha256, await sha256(new Blob([captured.text])), async file => ({
      id: `checkpoint:${attachment++}`, sha256: await sha256(file),
    }));
  }
  return captured;
}

function recordBytes(item: BrowserSourceCheckpoint, scienceBytes = item.science === null ? 4 : scientificDocumentPayload(item.science).retainedBytes) {
  return encoder.encode(JSON.stringify({ ...item, science: null })).byteLength - 4 + scienceBytes
    + (item.companions?.reduce((sum, companion) => sum + companion.file.size, 0) ?? 0);
}

/** Called at source admission; the immutable import is the authorization for this checkpoint. */
export async function browserCheckpointOriginal(path: string) {
  const scope = browserSourceCheckpointScope();
  if (!scope) return null;
  const original = await readBrowserImport(path);
  if (!original) return null;
  return { scope, path, originalSha256: await sha256(original.file), originalName: original.name, originalBytes: original.file.size };
}

export async function readBrowserSourceCheckpoint(path: string, scope = browserSourceCheckpointScope()) {
  if (!scope) return null;
  const db = await openBrowserImportDatabase();
  const value = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly"), request = tx.objectStore(STORE).get([scope, path]);
    tx.oncomplete = () => resolve(request.result); tx.onabort = tx.onerror = () => reject(error());
  });
  if (value === undefined) return null;
  const checkpoint = await checked(value), original = await readBrowserImport(path);
  if (checkpoint.scope !== scope || checkpoint.path !== path || !original || original.name !== checkpoint.originalName
    || original.file.size !== checkpoint.originalBytes || await sha256(original.file) !== checkpoint.originalSha256) throw error();
  return checkpoint;
}

/** Compare-and-swap prevents old source lifetimes and delayed closes from overwriting a successor. */
export async function writeBrowserSourceCheckpoint(
  target: { scope: string; path: string }, expectedId: string | null,
  next: BrowserSourceCheckpoint | null, isCurrent: () => boolean,
): Promise<boolean> {
  target = { scope: target.scope, path: target.path };
  const captured = next === null ? null : await checked(next);
  if (captured && (captured.path !== target.path || captured.scope !== target.scope)) throw error();
  if (!isCurrent() || target.scope !== browserSourceCheckpointScope()) return false;
  const db = await openBrowserImportDatabase();
  if (!isCurrent() || target.scope !== browserSourceCheckpointScope()) return false;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["files", STORE], "readwrite"), store = tx.objectStore(STORE);
    const records = store.getAll(undefined, MAX_RECORDS + 1), original = tx.objectStore("files").get(target.path);
    let applied = false, failure: unknown;
    tx.oncomplete = () => resolve(applied);
    tx.onabort = tx.onerror = () => reject(failure ?? error());
    original.onsuccess = () => {
      try {
        if (!isCurrent() || target.scope !== browserSourceCheckpointScope()) return;
        const values = records.result as BrowserSourceCheckpoint[];
        if (values.length > MAX_RECORDS) throw error();
        const previous = values.find(item => item.scope === target.scope && item.path === target.path);
        if ((previous?.id ?? null) !== expectedId) return;
        if (captured) {
          const file = original.result;
          if (!file || !(file.file instanceof Blob) || file.name !== captured.originalName || file.file.size !== captured.originalBytes) return;
          if (values.length - (previous ? 1 : 0) >= MAX_RECORDS
            || values.reduce((sum, item) => sum + (item === previous ? 0 : recordBytes(item)), recordBytes(captured)) > MAX_TOTAL_BYTES) {
            throw new Error("Browser draft storage is full. Save copies before clearing site storage.");
          }
          store.put(captured);
        } else store.delete([target.scope, target.path]);
        applied = true;
      } catch (caught) { failure = caught; tx.abort(); }
    };
  });
}

import { openBrowserImportDatabase, readBrowserImport } from "./browser-import-storage";
import { isBrowserSessionWorkspace } from "./window-scope";
import type { ScientificDocument } from "./molecular-workbench/scientific-types";
import { scientificDocumentPayload } from "./science-session/codec";
import { SCIENCE_SESSION_LIMITS } from "./science-session/contracts";
import { encodeMcdOriginals, type McdCompanionOriginal } from "./science-session/mcd-originals";
import { readXyzFrames } from "./science-session/source-frames";
import { validateScientificDocument } from "./science-session/scientific-document";

export type BrowserSourceStore = "source-checkpoints" | "scientific-attachments";
const STORES: BrowserSourceStore[] = ["source-checkpoints", "scientific-attachments"];
const MAX_RECORDS = 64;
export const BROWSER_SOURCE_CHECKPOINT_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_BYTES = 3_000_000;
const encoder = new TextEncoder();
const scopeKey = "burette.browser-source-session";

type SourcePayload = Readonly<{
  scope: string; path: string; id: string;
  originalSha256: string; originalName: string; originalBytes: number;
  text: string; science: ScientificDocument | null;
}>;
/** A source revision, never a renderer receipt, native Undo stack or executable session. */
export type BrowserSourceCheckpoint = SourcePayload & Readonly<{
  revision: number; baseText: string;
} & ({ version: 1; companions?: never } | { version: 2; companions: readonly McdCompanionOriginal[] })>;
/** Metadata attached to an unchanged import, independently of source-editing sessions. */
export type BrowserScientificAttachment = SourcePayload & Readonly<{
  kind: "scientific-attachment"; version: 1; title: string; science: ScientificDocument; companions: readonly McdCompanionOriginal[];
}>;
type Records = { "source-checkpoints": BrowserSourceCheckpoint; "scientific-attachments": BrowserScientificAttachment };
type SourceRecord = Records[BrowserSourceStore];

export function browserSourceSessionScope() {
  if (!isBrowserSessionWorkspace()) return null;
  let scope = window.sessionStorage.getItem(scopeKey);
  if (!scope || !/^[a-zA-Z0-9-]{1,128}$/u.test(scope)) {
    scope = crypto.randomUUID(); window.sessionStorage.setItem(scopeKey, scope);
  }
  return scope;
}

const error = () => new Error("The saved source data could not be read. Keep site storage intact and save a copy of your source.");
const sha256 = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("");

async function checked<S extends BrowserSourceStore>(value: unknown, store: S): Promise<Records[S]> {
  if (!value || typeof value !== "object") throw error();
  const item = value as SourcePayload & { version: number; kind?: string; title?: string; revision: number; baseText: string; companions?: readonly McdCompanionOriginal[] };
  if (typeof item.scope !== "string" || !/^[a-zA-Z0-9-]{1,128}$/u.test(item.scope)
    || typeof item.path !== "string" || !item.path.startsWith("/") || item.path.length > 1024
    || item.path.split("/").some(part => part === "." || part === ".." || part.includes("\0"))
    || typeof item.id !== "string" || !item.id || item.id.length > 160
    || typeof item.originalSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(item.originalSha256)
    || typeof item.originalName !== "string" || item.originalName.length > 255
    || !Number.isSafeInteger(item.originalBytes) || item.originalBytes < 0 || item.originalBytes > 24 * 1024 * 1024
    || typeof item.text !== "string" || encoder.encode(item.text).byteLength > MAX_TEXT_BYTES) throw error();
  const metadata = store === "scientific-attachments"
    ? { kind: "scientific-attachment" as const, version: 1 as const, title: item.title }
    : { version: item.version, revision: item.revision, baseText: item.baseText };
  if (store === "scientific-attachments" ? item.kind !== "scientific-attachment" || item.version !== 1 || typeof item.title !== "string" || !item.title || item.title.length > 255
    : (item.version !== 1 && item.version !== 2) || !Number.isSafeInteger(item.revision) || item.revision < 0
      || typeof item.baseText !== "string" || encoder.encode(item.baseText).byteLength > MAX_TEXT_BYTES) throw error();
  if (store === "source-checkpoints" && item.version === 1 ? item.companions !== undefined : !Array.isArray(item.companions) || !item.companions.length
    || item.companions.length > SCIENCE_SESSION_LIMITS.attachments || item.companions.some(entry => !entry || !(entry.file instanceof Blob))) throw error();
  if (item.science !== null) validateScientificDocument(item.science, readXyzFrames(item.text));
  if (store === "scientific-attachments" && !item.science?.frames.some(frame => frame.mcdCompanion)) throw error();
  const payload = item.science === null ? null : scientificDocumentPayload(item.science);
  if (recordBytes(item, payload?.byteLength ?? 4) > BROWSER_SOURCE_CHECKPOINT_BYTES) throw error();
  // Snapshot before the first await; only dense visible typed-array values are retained.
  const captured = {
    ...metadata, ...(item.companions ? { companions: structuredClone(item.companions) } : {}),
    scope: item.scope, path: item.path, id: item.id,
    originalSha256: item.originalSha256, originalName: item.originalName, originalBytes: item.originalBytes,
    text: item.text, science: payload?.clone() ?? null,
  } as Records[S];
  if (captured.companions || captured.science?.frames.some(frame => frame.mcdCompanion)) {
    let attachment = 0;
    await encodeMcdOriginals(captured.science, captured.companions, captured.originalSha256, await sha256(new Blob([captured.text])), async file => ({
      id: `source:${attachment++}`, sha256: await sha256(file),
    }));
  }
  return captured;
}

function recordBytes(item: SourcePayload & { companions?: readonly McdCompanionOriginal[] }, scienceBytes = item.science === null ? 4 : scientificDocumentPayload(item.science).retainedBytes) {
  return encoder.encode(JSON.stringify({ ...item, science: null })).byteLength - 4 + scienceBytes
    + (item.companions?.reduce((sum, companion) => sum + companion.file.size, 0) ?? 0);
}

/** Called at source admission; the immutable import is the authorization for this checkpoint. */
export async function browserSourceOriginal(path: string) {
  const scope = browserSourceSessionScope();
  if (!scope) return null;
  const original = await readBrowserImport(path);
  if (!original) return null;
  return { scope, path, originalSha256: await sha256(original.file), originalName: original.name, originalBytes: original.file.size };
}

export async function readBrowserSourceRecord<S extends BrowserSourceStore>(store: S, path: string, scope = browserSourceSessionScope()): Promise<Records[S] | null> {
  if (!scope) return null;
  const db = await openBrowserImportDatabase();
  const value = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(store, "readonly"), request = tx.objectStore(store).get([scope, path]);
    tx.oncomplete = () => resolve(request.result); tx.onabort = tx.onerror = () => reject(error());
  });
  if (value === undefined) return null;
  const checkpoint = await checked(value, store), original = await readBrowserImport(path);
  if (checkpoint.scope !== scope || checkpoint.path !== path || !original || original.name !== checkpoint.originalName
    || original.file.size !== checkpoint.originalBytes || await sha256(original.file) !== checkpoint.originalSha256) throw error();
  return checkpoint;
}

/** Compare-and-swap prevents old source lifetimes and delayed closes from overwriting a successor. */
export async function writeBrowserSourceRecord<S extends BrowserSourceStore>(
  storeName: S,
  target: { scope: string; path: string }, expectedId: string | null,
  next: Records[S] | null, isCurrent: () => boolean,
): Promise<boolean> {
  target = { scope: target.scope, path: target.path };
  const captured = next === null ? null : await checked(next, storeName);
  if (captured && (captured.path !== target.path || captured.scope !== target.scope)) throw error();
  if (!isCurrent() || target.scope !== browserSourceSessionScope()) return false;
  const db = await openBrowserImportDatabase();
  if (!isCurrent() || target.scope !== browserSourceSessionScope()) return false;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["files", ...STORES], "readwrite"), store = tx.objectStore(storeName);
    const records = STORES.map(name => ({ name, request: tx.objectStore(name).getAll(undefined, MAX_RECORDS + 1) }));
    const original = tx.objectStore("files").get(target.path);
    let applied = false, failure: unknown;
    tx.oncomplete = () => resolve(applied);
    tx.onabort = tx.onerror = () => reject(failure ?? error());
    original.onsuccess = () => {
      try {
        if (!isCurrent() || target.scope !== browserSourceSessionScope()) return;
        const values = records.flatMap(record => record.request.result as SourceRecord[]);
        if (values.length > MAX_RECORDS) throw error();
        const previous = (records.find(record => record.name === storeName)!.request.result as SourceRecord[])
          .find(item => item.scope === target.scope && item.path === target.path);
        if ((previous?.id ?? null) !== expectedId) return;
        if (captured) {
          const file = original.result;
          if (!file || !(file.file instanceof Blob) || file.name !== captured.originalName || file.file.size !== captured.originalBytes) return;
          if (values.length - (previous ? 1 : 0) >= MAX_RECORDS
            || values.reduce((sum, item) => sum + (item === previous ? 0 : recordBytes(item)), recordBytes(captured)) > MAX_TOTAL_BYTES) {
            throw new Error("Browser source storage is full. Save copies before clearing site storage.");
          }
          store.put(captured);
        } else store.delete([target.scope, target.path]);
        applied = true;
      } catch (caught) { failure = caught; tx.abort(); }
    };
  });
}

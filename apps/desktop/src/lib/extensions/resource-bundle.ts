import { Gunzip } from "fflate";
import lock from "../../../../../config/crystals-resource.lock.json";

export type ResourceCatalogEntry = {
  id: string; version: string;
  source: { repository: string; commit: string; prefix: string; archiveUrl: string; archiveBytes: number; archiveSha256: string };
  compressed: { bytes: number; sha256: string };
  corpus: { cifCount: number; cifBytes: number };
};
export type ResourceFile = { path: string; sha256: string; data: Uint8Array };
export type InstalledResource = { catalog: ResourceCatalogEntry; files: ResourceFile[] };
export const CRYSTALS_RESOURCE: ResourceCatalogEntry = { id: lock.id, version: lock.source.commit, source: lock.source,
  compressed: { bytes: lock.bundle.bytes, sha256: lock.bundle.sha256 }, corpus: lock.corpus };
const MAX_COMPRESSED = 1024 * 1024, MAX_DECODED = 8 * 1024 * 1024, MAX_TOTAL = 4 * 1024 * 1024;
const invalid = (): never => { throw new Error("Invalid or oversized resource bundle."); };
export function resourceAbort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Resource operation cancelled.", "AbortError"); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}
function label(value: unknown, max = 256): string {
  if (typeof value !== "string" || !value.length || value.length > max || /[\p{Cc}\p{Cf}]/u.test(value)) invalid();
  return value as string;
}
const hash = (value: unknown) => { const text = label(value, 64); if (!/^[a-f0-9]{64}$/u.test(text)) invalid(); return text; };
const count = (value: unknown, max: number) => { if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) invalid(); return value as number; };
export function checkedResourceCatalog(value: ResourceCatalogEntry): ResourceCatalogEntry {
  const entry = object(value, ["id", "version", "source", "compressed", "corpus"]), source = object(entry.source, ["repository", "commit", "prefix", "archiveUrl", "archiveBytes", "archiveSha256"]);
  const compressed = object(entry.compressed, ["bytes", "sha256"]), corpus = object(entry.corpus, ["cifCount", "cifBytes"]);
  const id = label(entry.id, 64), version = label(entry.version, 64), commit = label(source.commit, 40);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(id) || !/^[a-zA-Z0-9._-]+$/u.test(version) || !/^[a-f0-9]{40}$/u.test(commit)) invalid();
  return { id, version, source: { repository: label(source.repository), commit, prefix: label(source.prefix), archiveUrl: label(source.archiveUrl), archiveBytes: count(source.archiveBytes, 64 * 1024 * 1024), archiveSha256: hash(source.archiveSha256) },
    compressed: { bytes: count(compressed.bytes, MAX_COMPRESSED), sha256: hash(compressed.sha256) }, corpus: { cifCount: count(corpus.cifCount, 1024), cifBytes: count(corpus.cifBytes, MAX_TOTAL) } };
}
function path(value: unknown): string {
  const text = label(value);
  if (/[\\:]/u.test(text) || text.normalize("NFC") !== text || text.split("/").some(part => !part || part === "." || part === "..") || !(text.endsWith(".cif") || ["README.md", "plugin.json"].includes(text))) invalid();
  return text;
}
async function digest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), byte => byte.toString(16).padStart(2, "0")).join("");
}
const crcTable = Array.from({ length: 256 }, (_, value) => { for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
function unpack(input: Uint8Array) {
  if (input.length < 18 || input[0] !== 31 || input[1] !== 139 || input[2] !== 8 || input[3] !== 0) invalid();
  const trailer = new DataView(input.buffer, input.byteOffset + input.length - 8, 8);
  if (trailer.getUint32(4, true) > MAX_DECODED) invalid();
  const chunks: Uint8Array[] = []; let length = 0, crc = 0xffffffff;
  const inflater = new Gunzip(chunk => {
    length += chunk.length; if (length > MAX_DECODED) invalid();
    for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    chunks.push(chunk.slice());
  });
  inflater.onmember = invalid; // Reviewed resources use exactly one gzip member.
  for (let offset = 0; offset < input.length; offset += 1024) inflater.push(input.subarray(offset, offset + 1024), offset + 1024 >= input.length);
  if (length !== trailer.getUint32(4, true) || ((crc ^ 0xffffffff) >>> 0) !== trailer.getUint32(0, true)) invalid();
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
/** Only reviewed data is accepted. No URLs are fetched and no payload is executed. */
export async function verifyResourceBundle(catalog: ResourceCatalogEntry, provided: Uint8Array, signal?: AbortSignal): Promise<InstalledResource> {
  const entry = checkedResourceCatalog(catalog);
  resourceAbort(signal);
  if (!(provided instanceof Uint8Array) || provided.length !== entry.compressed.bytes) invalid();
  const input = provided.slice();
  if (await digest(input) !== entry.compressed.sha256) invalid();
  resourceAbort(signal);
  const document = object(JSON.parse(unpack(input)), ["schemaVersion", "id", "source", "files"]);
  const source = object(document.source, Object.keys(entry.source));
  if (document.schemaVersion !== 1 || document.id !== entry.id || Object.entries(entry.source).some(([key, value]) => source[key] !== value)
    || !Array.isArray(document.files) || document.files.length !== entry.corpus.cifCount + 2) invalid();
  const files: ResourceFile[] = [], seen = new Set<string>(); let total = 0, cifBytes = 0, cifs = 0;
  for (const value of document.files as unknown[]) {
    resourceAbort(signal);
    const file = object(value, ["path", "bytes", "sha256", "dataBase64"]), name = path(file.path), size = count(file.bytes, 32768);
    if (seen.has(name.toLowerCase()) || typeof file.dataBase64 !== "string" || file.dataBase64.length > 43692 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(file.dataBase64)) invalid();
    seen.add(name.toLowerCase()); total += size; if (total > MAX_TOTAL) invalid();
    const data = Uint8Array.from(atob(file.dataBase64 as string), character => character.charCodeAt(0));
    if (data.length !== size || await digest(data) !== hash(file.sha256)) invalid();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (data.includes(0) || (name.endsWith(".cif") && !/^data_\S+/imu.test(text))) invalid();
    if (name === "plugin.json") {
      const manifest = object(JSON.parse(text), ["author", "version", "name", "url", "description", "type"]);
      for (const field of ["author", "name", "url", "description"]) label(manifest[field]);
      if (manifest.type !== "data" || typeof manifest.version !== "number" || !Number.isFinite(manifest.version) || manifest.version <= 0) invalid();
    }
    if (name.endsWith(".cif")) { cifs++; cifBytes += size; }
    files.push({ path: name, sha256: file.sha256 as string, data });
  }
  resourceAbort(signal);
  if (cifs !== entry.corpus.cifCount || cifBytes !== entry.corpus.cifBytes || !seen.has("readme.md") || !seen.has("plugin.json")) invalid();
  return { catalog: entry, files };
}

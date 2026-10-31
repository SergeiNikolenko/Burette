import { unzipSync } from "fflate";
import type { ScientificDocument } from "../molecular-workbench/scientific-types";
import { ScienceSessionError, SCIENCE_SESSION_LIMITS, type ScienceSessionErrorCode } from "./contracts";
import { validateScientificDocument } from "./scientific-document";
import { readSdfSource } from "./sdf-source";
import { checkMcdOriginalDescriptors, encodeMcdOriginals, decodeMcdOriginals, type McdCompanionOriginal, type McdOriginalDescriptor } from "./mcd-originals";
import { sha256Hex } from "../source-editing/source-identity";
import { readSceneSourceFrames, type SceneSourceExtension } from "./source-frames";
import type { ScienceSceneBinding } from "./scene-binding";
export { sha256Hex, positionsMatch } from "../source-editing/source-identity";
export { readXyzFrames, readSceneSourceFrames, type XyzFrame } from "./source-frames";
export type { ScienceSceneBinding } from "./scene-binding";
export { normalizeElement, ScienceSessionError, SCIENCE_SESSION_LIMITS, type ScienceSessionErrorCode } from "./contracts";
export { validateScientificDocument } from "./scientific-document";

/**
 * Durable scientific state inside an ordinary Mol* MOLX scene.
 *
 * Mol* writes every asset of its AssetManager into the archive as `assets/<id>` and
 * lists them in `assets.json`; the asset tag is not written. Burette therefore owns a
 * reserved id namespace: one manifest asset and numbered binary attachments that the
 * manifest references by id. A session without the manifest is a foreign scene and
 * opens exactly as before. Everything here is pure: no Mol*, React or host state.
 */
export const SCIENCE_ASSET_PREFIX = "burette-science-";
export const SCIENCE_MANIFEST_ASSET_ID = "burette-science-manifest";
export const SCIENCE_MANIFEST_ASSET_NAME = "burette-science.json";
export const SCIENCE_SESSION_KIND = "burette.science-session";
export const SCIENCE_SESSION_VERSION = 3;
const ATTACHMENT_ID = /^burette-science-attachment-(\d{1,3})$/u;
export type AttachmentType = "utf8" | "json" | "bytes" | "float32le" | "float64le";
export type AttachmentDescriptor = { id: string; dtype: AttachmentType; count: number; byteLength: number; sha256: string };


export type ScienceManifest = {
  kind: typeof SCIENCE_SESSION_KIND;
  version: 1 | 2 | typeof SCIENCE_SESSION_VERSION;
  document: { uuid: string };
  /** The editable logical source; `sha256` identifies the revision the scene shows. */
  source: { extension: SceneSourceExtension; attachment: string; sha256: string };
  /** One durable id per real atom in source order; null when no mapping to earlier ids exists. */
  atoms: { count: number; ids: string[] | null };
  binding: ScienceSceneBinding;
  science: { attachment: string } | null;
  original: { name: string; type: string; attachment: string } | null;
  companions?: McdOriginalDescriptor[];
  attachments: AttachmentDescriptor[];
};

export type ScienceSessionContent = {
  documentUuid: string;
  source: { extension: SceneSourceExtension; text: string };
  atomIds: readonly string[] | null;
  binding: ScienceSceneBinding;
  science: ScientificDocument | null;
  original: { name: string; file: Blob } | null;
  companions?: readonly McdCompanionOriginal[];
};

export type DecodedScienceSession = ScienceSessionContent & { readonly manifestSha256: string };

export type ScienceSessionAsset = { id: string; name: string; bytes: Uint8Array };
export type EncodedScienceSession = { manifest: ScienceManifest; assets: ScienceSessionAsset[] };

// A declaration (not a const arrow), so that a call narrows the checked value like a throw.
function fail(code: ScienceSessionErrorCode, message: string): never {
  throw new ScienceSessionError(code, message);
}

function checkGraphSourceIds(text: string, extension: SceneSourceExtension, ids: readonly string[] | null) {
  if (extension !== "sdf") return;
  const expected = readSdfSource(text).atomIds;
  if (expected && (!ids || expected.some((id, index) => id !== ids[index]))) fail("source", "Graph atom ids do not match the source metadata.");
}

// ---------------------------------------------------------------------------------------------
// Scientific document <-> JSON plus binary arrays

type ArrayAllocation = { dtype: "float32le" | "float64le"; values: Float32Array | Float64Array };
const ATTACHMENT_REF = "$attachment";
const MAX_DEPTH = 12;

function toJsonSafe(value: unknown, path: string, depth: number, arrays: ArrayAllocation[], allocate: () => string): unknown {
  if (depth > MAX_DEPTH) fail("science", `Scientific data is nested too deeply at ${path}.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : fail("science", `Scientific data has a non-finite number at ${path}.`);
  if (value instanceof Float32Array || value instanceof Float64Array) {
    const allocation: ArrayAllocation = { dtype: value instanceof Float32Array ? "float32le" : "float64le", values: value };
    arrays.push(allocation);
    return { [ATTACHMENT_REF]: allocate() };
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) fail("science", `Scientific data has an unsupported binary array at ${path}.`);
  if (Array.isArray(value)) {
    return value.map((item, index) => item === undefined
      ? fail("science", `Scientific data has an empty item at ${path}[${index}].`)
      : toJsonSafe(item, `${path}[${index}]`, depth + 1, arrays, allocate));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("science", `Scientific data has an unsupported object at ${path}.`);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === ATTACHMENT_REF) fail("science", `Scientific data uses the reserved key ${key}.`);
      if (item === undefined) continue;
      out[key] = toJsonSafe(item, `${path}.${key}`, depth + 1, arrays, allocate);
    }
    return out;
  }
  return fail("science", `Scientific data has an unsupported value at ${path}.`);
}

function floatBytes(allocation: ArrayAllocation) {
  const width = allocation.dtype === "float32le" ? 4 : 8;
  const bytes = new Uint8Array(allocation.values.length * width);
  const view = new DataView(bytes.buffer);
  allocation.values.forEach((value, index) => {
    if (!Number.isFinite(value)) fail("science", "A scientific array has a non-finite value.");
    if (width === 4) view.setFloat32(index * 4, value, true);
    else view.setFloat64(index * 8, value, true);
  });
  return bytes;
}

function readFloats(bytes: Uint8Array, dtype: "float32le" | "float64le", count: number) {
  const width = dtype === "float32le" ? 4 : 8;
  if (bytes.byteLength !== count * width) fail("attachment", "A scientific array has the wrong length.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = dtype === "float32le" ? new Float32Array(count) : new Float64Array(count);
  for (let index = 0; index < count; index++) {
    const value = width === 4 ? view.getFloat32(index * 4, true) : view.getFloat64(index * 8, true);
    if (!Number.isFinite(value)) fail("attachment", "A scientific array has a non-finite value.");
    values[index] = value;
  }
  return values;
}

function fromJson(value: unknown, path: string, depth: number, resolve: (id: string) => Float32Array | Float64Array): unknown {
  if (depth > MAX_DEPTH) fail("science", `Scientific data is nested too deeply at ${path}.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  // JSON.parse turns 1e400 into Infinity.
  if (typeof value === "number") return Number.isFinite(value) ? value : fail("science", `Scientific data has a non-finite number at ${path}.`);
  if (Array.isArray(value)) return value.map((item, index) => fromJson(item, `${path}[${index}]`, depth + 1, resolve));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (ATTACHMENT_REF in record) {
      const id = record[ATTACHMENT_REF];
      if (Object.keys(record).length !== 1 || typeof id !== "string") fail("science", `Scientific data has a malformed array reference at ${path}.`);
      return resolve(id as string);
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, fromJson(item, `${path}.${key}`, depth + 1, resolve)]));
  }
  return fail("science", `Scientific data has an unsupported value at ${path}.`);
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// ---------------------------------------------------------------------------------------------
// Encoding

const attachmentId = (index: number) => `${SCIENCE_ASSET_PREFIX}attachment-${index}`;

/** Manifest and attachment assets for one acknowledged revision; nothing is written. */
export async function encodeScienceSession(content: ScienceSessionContent): Promise<EncodedScienceSession> {
  const frames = readSceneSourceFrames(content.source.text, content.source.extension);
  checkGraphSourceIds(content.source.text, content.source.extension, content.atomIds);
  if (content.source.extension !== "xyz" && content.science) fail("science", "Graph scenes cannot carry XYZ scientific arrays.");
  const elements = frames[0].elements;
  const { binding } = content;
  if (binding.atomCount !== elements.length || binding.frameCount !== frames.length || binding.frameIndex < 0 || binding.frameIndex >= frames.length) {
    fail("binding", "The scene does not show the source it is saved with.");
  }
  if (content.atomIds && (content.atomIds.length !== elements.length || new Set(content.atomIds).size !== elements.length)) fail("source", "Atom ids do not match the source atoms.");
  const assets: ScienceSessionAsset[] = [];
  const attachments: AttachmentDescriptor[] = [];
  let total = 0;
  const add = async (dtype: AttachmentType, bytes: Uint8Array, count: number) => {
    if (attachments.length >= SCIENCE_SESSION_LIMITS.attachments) fail("limit", "Scientific data has too many arrays to save with the scene.");
    total += bytes.byteLength;
    if (total > SCIENCE_SESSION_LIMITS.attachmentBytes) fail("limit", "Scientific data exceeds the 20 MiB a scene can carry.");
    const id = attachmentId(attachments.length);
    attachments.push({ id, dtype, count, byteLength: bytes.byteLength, sha256: await sha256Hex(bytes) });
    assets.push({ id, name: `${id}.bin`, bytes });
    return id;
  };
  const sourceBytes = new TextEncoder().encode(content.source.text);
  const sourceAttachment = await add("utf8", sourceBytes, sourceBytes.byteLength);
  let science: ScienceManifest["science"] = null;
  if (content.science) {
    validateScientificDocument(content.science, frames);
    // Arrays follow the JSON's own attachment, numbered in the order the walk meets them.
    const jsonIndex = attachments.length;
    const pending: ArrayAllocation[] = [];
    const json = toJsonSafe(content.science, "science", 0, pending, () => attachmentId(jsonIndex + pending.length));
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    science = { attachment: await add("json", jsonBytes, jsonBytes.byteLength) };
    for (const allocation of pending) await add(allocation.dtype, floatBytes(allocation), allocation.values.length);
  }
  let original: ScienceManifest["original"] = null;
  if (content.original) {
    const name = content.original.name.slice(0, SCIENCE_SESSION_LIMITS.originalName);
    const bytes = new Uint8Array(await content.original.file.arrayBuffer());
    original = { name, type: content.original.file.type.slice(0, 128), attachment: await add("bytes", bytes, bytes.byteLength) };
  }
  const companions = await encodeMcdOriginals(content.science, content.companions,
    original ? attachments.find(item => item.id === original!.attachment)!.sha256 : null, attachments[0].sha256, async file => {
      if (file.size > SCIENCE_SESSION_LIMITS.attachmentBytes - total) fail("limit", "Scientific data exceeds the 20 MiB a scene can carry.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = await add("bytes", bytes, bytes.byteLength);
      return { id, sha256: attachments.find(item => item.id === id)!.sha256 };
    });
  const manifest: ScienceManifest = {
    kind: SCIENCE_SESSION_KIND,
    // Keep XYZ/SDF v1 and MOL v2 byte behavior; paired companion bytes require v3.
    version: companions ? SCIENCE_SESSION_VERSION : content.source.extension === "mol" ? 2 : 1,
    document: { uuid: content.documentUuid },
    source: { extension: content.source.extension, attachment: sourceAttachment, sha256: attachments[0].sha256 },
    atoms: { count: elements.length, ids: content.atomIds ? [...content.atomIds] : null },
    binding: { structureRef: binding.structureRef, modelRef: binding.modelRef, trajectoryRef: binding.trajectoryRef,
      frameIndex: binding.frameIndex, frameCount: binding.frameCount, atomCount: binding.atomCount },
    science,
    original,
    ...(companions ? { companions } : {}),
    attachments,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (manifestBytes.byteLength > SCIENCE_SESSION_LIMITS.manifestBytes) fail("limit", "The scientific manifest is too large.");
  return { manifest, assets: [{ id: SCIENCE_MANIFEST_ASSET_ID, name: SCIENCE_MANIFEST_ASSET_NAME, bytes: manifestBytes }, ...assets] };
}

// ---------------------------------------------------------------------------------------------
// Decoding

/** The ZIP entries Burette reads from a MOLX archive, within the archive limits. */
function readScienceEntries(archive: Uint8Array) {
  if (archive.byteLength > SCIENCE_SESSION_LIMITS.archiveBytes) fail("limit", "The scene file exceeds 32 MiB.");
  let entries = 0;
  let expanded = 0;
  let hasState = false;
  const declared = new Map<string, number>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive, {
      filter: (file) => {
        if (++entries > SCIENCE_SESSION_LIMITS.entries) fail("limit", "The scene file has too many entries.");
        if (file.name === "state.json") hasState = true;
        const ours = file.name === "assets.json" || file.name.startsWith(`assets/${SCIENCE_ASSET_PREFIX}`);
        if (!ours) return false;
        const limit = file.name === "assets.json" ? SCIENCE_SESSION_LIMITS.assetIndexBytes : SCIENCE_SESSION_LIMITS.attachmentBytes;
        expanded += file.originalSize;
        if (file.originalSize > limit || expanded > SCIENCE_SESSION_LIMITS.attachmentBytes + SCIENCE_SESSION_LIMITS.assetIndexBytes) fail("limit", "Scientific data in the scene file exceeds its size limit.");
        if (declared.has(file.name)) fail("archive", "The scene file repeats an entry.");
        declared.set(file.name, file.originalSize);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ScienceSessionError) throw error;
    return fail("archive", `The scene file is not a readable MOLX archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const [name, size] of declared) if (files[name]?.byteLength !== size) fail("archive", "A scene file entry does not match its declared size.");
  return { files, hasState };
}

function decodeJson(bytes: Uint8Array, what: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail("manifest", `The ${what} is not valid JSON.`);
  }
}

function checkManifest(value: unknown): ScienceManifest {
  if (!isRecord(value) || value.kind !== SCIENCE_SESSION_KIND) fail("manifest", "The scientific manifest is not a Burette manifest.");
  const manifest = value as Record<string, unknown>;
  if (manifest.version !== 1 && manifest.version !== 2 && manifest.version !== SCIENCE_SESSION_VERSION) fail("version", `Scientific data version ${String(manifest.version).slice(0, 16)} is not supported by this Burette.`);
  const document = manifest.document, source = manifest.source, atoms = manifest.atoms, binding = manifest.binding;
  if (!isRecord(document) || typeof document.uuid !== "string" || !/^[0-9a-f-]{8,64}$/iu.test(document.uuid)) fail("manifest", "The scientific manifest lacks its document id.");
  if (!isRecord(source) || !["xyz", "sdf", "mol"].includes(source.extension as string) || typeof source.attachment !== "string" || typeof source.sha256 !== "string") fail("manifest", "The scientific manifest lacks its source.");
  if (source.extension === "mol" && manifest.version === 1) fail("version", "MOL scene sources require scientific data version 2 or later.");
  if (manifest.version === 3) {
    if (!Array.isArray(manifest.companions) || !manifest.companions.length) fail("version", "Scientific data version 3 requires paired companion Originals.");
    checkMcdOriginalDescriptors(manifest.companions);
  }
  else if (manifest.companions !== undefined) fail("version", "Paired companion Originals require scientific data version 3.");
  if (!isRecord(atoms) || !Number.isInteger(atoms.count) || (atoms.count as number) < 1 || (atoms.count as number) > SCIENCE_SESSION_LIMITS.atoms) fail("manifest", "The scientific manifest has an invalid atom count.");
  const ids = (atoms as Record<string, unknown>).ids;
  if (ids !== null && (!Array.isArray(ids) || ids.length !== atoms.count || !ids.every((id) => typeof id === "string" && id.length <= 64)
    || new Set(ids).size !== ids.length)) fail("manifest", "The scientific manifest has invalid atom ids.");
  if (!isRecord(binding) || !["structureRef", "modelRef", "trajectoryRef"].every((key) => typeof binding[key] === "string" && (binding[key] as string).length <= 256)
    || !Number.isInteger(binding.frameIndex) || !Number.isInteger(binding.frameCount) || binding.atomCount !== atoms.count
    || (binding.frameIndex as number) < 0 || (binding.frameIndex as number) >= (binding.frameCount as number)) fail("manifest", "The scientific manifest has an invalid structure binding.");
  const science = manifest.science, original = manifest.original;
  if (science !== null && (!isRecord(science) || typeof science.attachment !== "string")) fail("manifest", "The scientific manifest has an invalid data reference.");
  if (original !== null && (!isRecord(original) || typeof original.name !== "string" || original.name.length > SCIENCE_SESSION_LIMITS.originalName
    || typeof original.type !== "string" || typeof original.attachment !== "string")) fail("manifest", "The scientific manifest has an invalid original file.");
  if (!Array.isArray(manifest.attachments) || manifest.attachments.length > SCIENCE_SESSION_LIMITS.attachments) fail("manifest", "The scientific manifest lists too many attachments.");
  let total = 0;
  const seen = new Set<string>();
  for (const item of manifest.attachments as unknown[]) {
    if (!isRecord(item) || typeof item.id !== "string" || !ATTACHMENT_ID.test(item.id) || seen.has(item.id)
      || !["utf8", "json", "bytes", "float32le", "float64le"].includes(item.dtype as string)
      || !Number.isSafeInteger(item.count) || !Number.isSafeInteger(item.byteLength) || (item.count as number) < 0
      || typeof item.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(item.sha256)) fail("manifest", "The scientific manifest has an invalid attachment.");
    const width = item.dtype === "float32le" ? 4 : item.dtype === "float64le" ? 8 : 1;
    // Lengths are checked against the declared type before anything is read or allocated.
    if ((item.count as number) * width !== item.byteLength) fail("attachment", `Attachment ${item.id as string} has an invalid length for ${item.dtype as string}.`);
    total += item.byteLength as number;
    if (total > SCIENCE_SESSION_LIMITS.attachmentBytes) fail("limit", "Scientific data in the scene file exceeds 20 MiB.");
    seen.add(item.id as string);
  }
  return manifest as unknown as ScienceManifest;
}

/**
 * Reads and fully validates the scientific state of a MOLX archive. Returns null for a
 * foreign session (no Burette manifest). Throws ScienceSessionError when a manifest exists
 * but any part of it cannot be restored; nothing partial is returned.
 */
export async function decodeScienceSession(archive: Uint8Array): Promise<DecodedScienceSession | null> {
  const { files, hasState } = readScienceEntries(archive);
  const ours = Object.keys(files).filter((name) => name.startsWith(`assets/${SCIENCE_ASSET_PREFIX}`));
  if (!ours.length) return null;
  if (!hasState) fail("archive", "The scene file has no Mol* state.");
  if (!files["assets.json"]) fail("archive", "The scene file has no asset index.");
  const index = decodeJson(files["assets.json"], "scene asset index");
  if (!Array.isArray(index) || index.length > SCIENCE_SESSION_LIMITS.entries) fail("archive", "The scene asset index is malformed.");
  const indexed = new Set((index as unknown[]).flatMap((entry) => (Array.isArray(entry) && typeof entry[0] === "string" && isRecord(entry[1]) && entry[1].id === entry[0] ? [entry[0]] : [])));
  const manifestBytes = files[`assets/${SCIENCE_MANIFEST_ASSET_ID}`];
  if (!manifestBytes || !indexed.has(SCIENCE_MANIFEST_ASSET_ID)) fail("manifest", "The scene file carries scientific attachments without their manifest.");
  if (manifestBytes.byteLength > SCIENCE_SESSION_LIMITS.manifestBytes) fail("limit", "The scientific manifest is too large.");
  const manifest = checkManifest(decodeJson(manifestBytes, "scientific manifest"));
  const descriptors = new Map(manifest.attachments.map((item) => [item.id, item]));
  const used = new Set<string>();
  const attachment = async (id: string, dtypes: readonly AttachmentType[]) => {
    const descriptor = descriptors.get(id);
    if (!descriptor || !dtypes.includes(descriptor.dtype)) fail("manifest", `The scientific manifest references unknown attachment ${id.slice(0, 64)}.`);
    const bytes = files[`assets/${id}`];
    if (!bytes || !indexed.has(id)) fail("attachment", `Scientific attachment ${id} is missing from the scene file.`);
    if (bytes.byteLength !== descriptor!.byteLength) fail("attachment", `Scientific attachment ${id} has the wrong length.`);
    if (await sha256Hex(bytes) !== descriptor!.sha256) fail("attachment", `Scientific attachment ${id} is corrupted.`);
    used.add(id);
    return { bytes, descriptor: descriptor! };
  };
  const source = await attachment(manifest.source.attachment, ["utf8"]);
  if (manifest.source.sha256 !== source.descriptor.sha256) fail("source", "The scene source does not match its revision.");
  let text: string;
  try {
    // The source is the exact text: a byte order mark stays part of it.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(source.bytes);
  } catch {
    return fail("source", "The scene source is not UTF-8 text.");
  }
  const frames = readSceneSourceFrames(text, manifest.source.extension);
  checkGraphSourceIds(text, manifest.source.extension, manifest.atoms.ids);
  if (manifest.source.extension !== "xyz" && manifest.science) fail("science", "Graph scenes cannot carry XYZ scientific arrays.");
  const elements = frames[0].elements;
  if (elements.length !== manifest.atoms.count || frames.length !== manifest.binding.frameCount) fail("binding", "The scene source does not match its structure binding.");
  let science: ScientificDocument | null = null;
  if (manifest.science) {
    const json = await attachment(manifest.science.attachment, ["json"]);
    const arrays = new Map<string, Float32Array | Float64Array>();
    for (const descriptor of manifest.attachments) {
      if (descriptor.dtype !== "float32le" && descriptor.dtype !== "float64le") continue;
      const { bytes } = await attachment(descriptor.id, [descriptor.dtype]);
      arrays.set(descriptor.id, readFloats(bytes, descriptor.dtype, descriptor.count));
    }
    const referenced = new Set<string>();
    const decoded = fromJson(decodeJson(json.bytes, "scientific data"), "science", 0, (id) => {
      const values = arrays.get(id);
      if (!values || referenced.has(id)) return fail("science", `Scientific data references a missing array ${id.slice(0, 64)}.`);
      referenced.add(id);
      return values;
    });
    if (referenced.size !== arrays.size) fail("science", "The scene file carries scientific arrays nothing refers to.");
    science = validateScientificDocument(decoded, frames);
  }
  let original: ScienceSessionContent["original"] = null;
  if (manifest.original) {
    const file = await attachment(manifest.original.attachment, ["bytes"]);
    original = { name: manifest.original.name, file: new Blob([file.bytes as BlobPart], { type: manifest.original.type }) };
  }
  const companions = await decodeMcdOriginals(science, manifest.companions,
    manifest.original ? descriptors.get(manifest.original.attachment)!.sha256 : null, source.descriptor.sha256, async id => {
      const file = await attachment(id, ["bytes"]);
      return { bytes: file.bytes, sha256: file.descriptor.sha256 };
    });
  if (used.size !== manifest.attachments.length || ours.length !== manifest.attachments.length + 1) fail("attachment", "The scene file carries scientific attachments its manifest does not use.");
  return {
    manifestSha256: await sha256Hex(manifestBytes),
    documentUuid: manifest.document.uuid,
    source: { extension: manifest.source.extension, text },
    atomIds: manifest.atoms.ids,
    binding: manifest.binding,
    science,
    original,
    ...(companions ? { companions } : {}),
  };
}

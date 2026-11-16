import { atomicNumber } from "../molecular-workbench/elements";
import { checkMcdCompanion, type McdCompanionBinding } from "../molecular-workbench/mcd-companion";
import type { ScientificDocument } from "../molecular-workbench/scientific-types";
import { SCIENCE_SESSION_LIMITS, ScienceSessionError } from "./contracts";

type CompanionKey = McdCompanionBinding & { role: "orca-mcd"; frameIndex: number; frameCount: number; name: string; originRevisionSha256?: string };
export type McdCompanionOriginal = CompanionKey & { file: Blob };
export type McdOriginalDescriptor = CompanionKey & { type: string; attachment: string };
type Binary = { id: string; sha256: string };
const HASHES = ["primaryOriginalSha256", "companionOriginalSha256", "sourceRevisionSha256"] as const;
function fail(message: string): never { throw new ScienceSessionError("science", `MCD companion: ${message}`); }
const key = (value: McdCompanionBinding, index: number, count: number) => `${value.primaryOriginalSha256}:${value.companionOriginalSha256}:${value.sourceRevisionSha256}:${index}:${count}`;
function checkKey(value: CompanionKey) {
  if (value.role !== "orca-mcd" || !Number.isSafeInteger(value.frameIndex) || !Number.isSafeInteger(value.frameCount)
    || value.frameIndex < 0 || value.frameIndex >= value.frameCount || value.frameCount > SCIENCE_SESSION_LIMITS.frames
    || typeof value.name !== "string" || !value.name.length || value.name.length > SCIENCE_SESSION_LIMITS.originalName
    || HASHES.some(field => typeof value[field] !== "string" || !/^[a-f0-9]{64}$/u.test(value[field]))
    || (value.originRevisionSha256 !== undefined && (typeof value.originRevisionSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.originRevisionSha256)))) fail("invalid Original label or scientific revision/frame binding.");
}
export function checkMcdOriginalDescriptors(value: unknown): McdOriginalDescriptor[] {
  if (!Array.isArray(value) || !value.length || value.length > SCIENCE_SESSION_LIMITS.attachments) fail("invalid Original attachment list.");
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).some(field => !["role", "frameIndex", "frameCount", "name", "type", "attachment", "originRevisionSha256", ...HASHES].includes(field))
      || typeof entry.type !== "string" || entry.type.length > 128 || typeof entry.attachment !== "string") fail("invalid Original attachment metadata.");
    checkKey(entry);
  }
  if (new Set(value.map(entry => entry.attachment)).size !== value.length) fail("repeated Original attachment.");
  return value as McdOriginalDescriptor[];
}
function checkCollection(entries: readonly CompanionKey[], primarySha256: string | null) {
  if (entries.length > SCIENCE_SESSION_LIMITS.attachments) fail("too many raw Originals.");
  const seen = new Set<string>();
  for (const entry of entries) {
    checkKey(entry);
    if (!primarySha256 || entry.primaryOriginalSha256 !== primarySha256) fail("raw Original does not belong to the retained primary Original.");
    const identity = key(entry, entry.frameIndex, entry.frameCount);
    if (seen.has(identity)) fail("repeated source revision/frame pair.");
    seen.add(identity);
  }
}
function checkCurrentData(science: ScientificDocument | null, entries: readonly CompanionKey[], primarySha256: string | null, sourceSha256: string) {
  for (const [index, frame] of science?.frames.entries() ?? []) {
    if (!frame.mcdCompanion) continue;
    const pair = frame.mcdCompanion;
    const entry = entries.find(item => key(item, item.frameIndex, item.frameCount) === key(pair, index, science!.frames.length));
    if (!entry || !primarySha256) fail("calculated data lacks its exact paired raw Original.");
    try {
      checkMcdCompanion(pair, { primaryOriginalSha256: primarySha256, companionOriginalSha256: entry.companionOriginalSha256,
        sourceRevisionSha256: sourceSha256, frameIndex: index, frameCount: science!.frames.length,
        atomicNumbers: frame.atoms.map(atom => atomicNumber(atom.element)) });
      if (pair.spectra.source.name !== entry.name) fail("calculated data and raw Original have different source labels.");
    } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  }
}

/** Historical raw bytes remain provenance after edits; only exact current pairs authorize data. */
export async function encodeMcdOriginals(science: ScientificDocument | null, originals: readonly McdCompanionOriginal[] | undefined,
  primarySha256: string | null, sourceSha256: string, put: (file: Blob) => Promise<Binary>): Promise<McdOriginalDescriptor[] | undefined> {
  if (originals !== undefined && !Array.isArray(originals)) fail("invalid Original list.");
  const entries = originals ?? [];
  if (entries.some(entry => !entry || typeof entry !== "object" || Array.isArray(entry)
    || Object.keys(entry).some(field => !["role", "frameIndex", "frameCount", "name", "originRevisionSha256", "file", ...HASHES].includes(field)))) fail("invalid raw Original metadata.");
  checkCollection(entries, primarySha256);
  checkCurrentData(science, entries, primarySha256, sourceSha256);
  const result: McdOriginalDescriptor[] = [];
  for (const entry of entries) {
    if (!(entry.file instanceof Blob) || entry.file.type.length > 128) fail("expected an explicitly selected Original Blob.");
    const binary = await put(entry.file);
    if (binary.sha256 !== entry.companionOriginalSha256) fail("raw companion bytes do not match their source identity.");
    result.push({ role: "orca-mcd", frameIndex: entry.frameIndex, frameCount: entry.frameCount, name: entry.name,
      primaryOriginalSha256: entry.primaryOriginalSha256, companionOriginalSha256: entry.companionOriginalSha256,
      sourceRevisionSha256: entry.sourceRevisionSha256, ...(entry.originRevisionSha256 ? { originRevisionSha256: entry.originRevisionSha256 } : {}),
      type: entry.file.type, attachment: binary.id });
  }
  return result.length ? result : undefined;
}
export async function decodeMcdOriginals(science: ScientificDocument | null, entries: readonly McdOriginalDescriptor[] | undefined,
  primarySha256: string | null, sourceSha256: string, get: (id: string) => Promise<{ bytes: Uint8Array; sha256: string }>): Promise<McdCompanionOriginal[] | undefined> {
  checkCollection(entries ?? [], primarySha256);
  checkCurrentData(science, entries ?? [], primarySha256, sourceSha256);
  const originals: McdCompanionOriginal[] = [];
  for (const entry of entries ?? []) {
    const binary = await get(entry.attachment);
    if (binary.sha256 !== entry.companionOriginalSha256) fail("raw companion bytes do not match their source identity.");
    const { type, attachment, ...binding } = entry;
    originals.push({ ...binding, file: new Blob([binary.bytes as BlobPart], { type }) });
  }
  return originals.length ? originals : undefined;
}

import { sha256Hex } from "../source-editing/source-identity";

type Pair = { from: string; to: string; atomCount: number; sourceFormat: "sdf" | "mol" };
const pairs = new Map<string, Pair[]>();

/** Hashing prepares no authorization; a rejected edit must leave the registry untouched. */
export async function prepareMeasurementSourcePair(from: string, to: string, atomCount: number, sourceFormat: "sdf" | "mol" = "sdf") {
  const [fromHash, toHash] = await Promise.all([sha256Hex(from), sha256Hex(to)]);
  return Object.freeze({ from: fromHash, to: toHash, atomCount, sourceFormat });
}

/** Publish synchronously beside the acknowledged draft commit, before preview preparation can run. */
export function publishMeasurementSourcePair(documentId: string, pair: Readonly<Pair>) {
  const previous = pairs.get(documentId) ?? [];
  pairs.delete(documentId); pairs.set(documentId, [...previous, pair].slice(-100));
  while (pairs.size > 16) pairs.delete(pairs.keys().next().value!);
}

/** Verified positions-only edits and metadata-only edits preserve the source atom order and graph. */
export async function rememberMeasurementSourcePair(documentId: string, from: string, to: string, atomCount: number, sourceFormat: "sdf" | "mol" = "sdf") {
  publishMeasurementSourcePair(documentId, await prepareMeasurementSourcePair(from, to, atomCount, sourceFormat));
}

export async function measurementPreviewTarget(documentId: string, text: string) {
  const known = pairs.get(documentId);
  if (!known) return null;
  const digest = await sha256Hex(text);
  return known.some(pair => pair.from === digest || pair.to === digest) ? digest : null;
}

/** A fresh capture must belong to the same verified graph family, including Undo/Redo paths. */
export function measurementPreviewTransfer(documentId: string, targetSourceSha256: string, capture: Record<string, unknown>) {
  const atomCount = capture.atomCount;
  const seen = new Set([targetSourceSha256]);
  const edges = (pairs.get(documentId) ?? []).filter(pair => pair.atomCount === atomCount && pair.sourceFormat === capture.sourceFormat);
  for (let pass = 0; pass < edges.length; pass++) for (const edge of edges) {
    if (seen.has(edge.from) || seen.has(edge.to)) { seen.add(edge.from); seen.add(edge.to); }
  }
  if (typeof capture.sourceSha256 !== "string" || !seen.has(capture.sourceSha256) || !edges.some(edge => edge.from === targetSourceSha256 || edge.to === targetSourceSha256)
    || !Array.isArray(capture.items) || capture.items.length > 32) throw new Error("The displayed structure changed. Open the measurement again.");
  const transfer = { version: 1, sourceFormat: capture.sourceFormat, targetSourceSha256, atomCount, items: capture.items, group: capture.group };
  if (new TextEncoder().encode(JSON.stringify(transfer)).byteLength > 6144) throw new Error("There are too many measurement settings to retain. Remove some measurements before editing.");
  return transfer;
}

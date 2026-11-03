import { sha256Hex } from "../source-editing/source-identity";
import { remapSourcePoints } from "../science-session/atom-provenance";

// `mapping` (atom reorder): entry i of `to` is atom mapping[i] of `from`. Absent means the same order.
type Pair = { from: string; to: string; atomCount: number; sourceFormat: "sdf" | "mol"; mapping?: readonly number[] };
const pairs = new Map<string, Pair[]>();

/** Hashing prepares no authorization; a rejected edit must leave the registry untouched. */
export async function prepareMeasurementSourcePair(from: string, to: string, atomCount: number, sourceFormat: "sdf" | "mol" = "sdf", mapping?: readonly number[]) {
  let order: readonly number[] | undefined;
  if (mapping) {
    if (atomCount > 256 || atomCount < 1 || mapping.length !== atomCount) throw new Error("The atom order is not a permutation.");
    order = Object.freeze([...mapping]);
    if (new Set(order).size !== atomCount || order.some(index => !Number.isInteger(index) || index < 0 || index >= atomCount)) throw new Error("The atom order is not a permutation.");
  }
  const [fromHash, toHash] = await Promise.all([sha256Hex(from), sha256Hex(to)]);
  return Object.freeze({ from: fromHash, to: toHash, atomCount, sourceFormat, ...(order ? { mapping: order } : {}) });
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
  const { atomCount, sourceSha256 } = capture;
  const edges = (pairs.get(documentId) ?? []).filter(pair => pair.atomCount === atomCount && pair.sourceFormat === capture.sourceFormat);
  const changed = () => new Error("The displayed structure changed. Open the measurement again.");
  if (typeof sourceSha256 !== "string" || !edges.some(edge => edge.from === targetSourceSha256 || edge.to === targetSourceSha256)
    || !Array.isArray(capture.items) || capture.items.length > 32) throw changed();

  // Each route maps the destination's rows back to the captured rows.
  // null represents unchanged atom order and needs no per-atom allocation.
  const routes = new Map<string, readonly number[] | null>([[sourceSha256, null]]);
  for (const [hash, order] of routes) {
    if (hash === targetSourceSha256) break;
    for (const edge of edges) {
      const forward = edge.from === hash;
      const next = forward ? edge.to : edge.to === hash ? edge.from : null;
      if (next === null || routes.has(next)) continue;
      let mapping = edge.mapping;
      if (mapping && !forward) {
        const inverse = Array<number>(mapping.length);
        mapping.forEach((source, target) => { inverse[source] = target; });
        mapping = inverse;
      }
      routes.set(next, order && mapping ? mapping.map(index => order[index]) : order ?? mapping ?? null);
    }
  }
  const route = routes.get(targetSourceSha256);
  if (route === undefined) throw changed();
  const items = route ? capture.items.map(item => {
    if (!item || !Array.isArray(item.points) || !item.points.every(Array.isArray)) throw changed();
    const points = remapSourcePoints(item.points, route, route.length);
    if (!points) throw changed();
    return { ...item, points };
  }) : capture.items;
  const transfer = { version: 1, sourceFormat: capture.sourceFormat, targetSourceSha256, atomCount, items, group: capture.group,
    ...(capture.groupParams === undefined ? {} : { groupParams: capture.groupParams }),
    ...(capture.groupTags === undefined ? {} : { groupTags: capture.groupTags }) };
  if (new TextEncoder().encode(JSON.stringify(transfer)).byteLength > 6144) throw new Error("There are too many measurement settings to retain. Remove some measurements before editing.");
  return transfer;
}

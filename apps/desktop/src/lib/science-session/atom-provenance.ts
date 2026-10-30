import type { ImportedRevision } from "../workbench/scientific-source-state";

/** Exact new-index → previous-index provenance; -1 denotes a genuinely inserted atom. */
export function validateAtomProvenance(mapping: readonly number[], previousCount: number, count: number, sameTopology: boolean) {
  const used = new Set<number>();
  if (!Array.isArray(mapping) || mapping.length !== count || !Number.isSafeInteger(count) || count < 1
    || !Number.isSafeInteger(previousCount) || previousCount < 1) throw new Error("Invalid atom provenance.");
  for (const source of mapping) {
    if (!Number.isSafeInteger(source) || source < -1 || source >= previousCount || (source >= 0 && used.has(source))) throw new Error("Invalid atom provenance.");
    if (source >= 0) used.add(source);
  }
  if (sameTopology && (count !== previousCount || mapping.some((source, target) => source !== target))) {
    throw new Error("Atom correspondence changed without a topology revision.");
  }
}

/** Composition uses recorded row provenance only, including the inverse edges of Undo. */
export function topologyAtomMapping(revisions: readonly ImportedRevision[], from: ImportedRevision, target: ImportedRevision): number[] {
  const fromIndex = revisions.indexOf(from), targetIndex = revisions.indexOf(target);
  if (fromIndex < 0) throw new Error("The scientific source changed before the edit.");
  const count = (revision: ImportedRevision) => {
    const n = revision.document.atoms.length;
    if (!Number.isInteger(n) || n < 1 || n > 256) throw new Error("Topology editing supports up to 256 atoms.");
    return n;
  };
  const edge = (previous: ImportedRevision, next: ImportedRevision) => {
    const n = count(next), previousCount = count(previous), same = (next.topology ?? 0) === (previous.topology ?? 0);
    if (!same && next.sourceAtomIndices === undefined) throw new Error("This topology has no exact atom correspondence.");
    const mapping = next.sourceAtomIndices ?? Array.from({ length: n }, (_, index) => index);
    validateAtomProvenance(mapping, previousCount, n, same);
    return mapping;
  };
  let mapping = Array.from({ length: count(from) }, (_, index) => index);
  if (targetIndex < 0) return [...edge(from, target)];
  for (let index = fromIndex; index < targetIndex; index++) {
    mapping = edge(revisions[index], revisions[index + 1]).map(source => source < 0 ? -1 : mapping[source]);
  }
  for (let index = fromIndex; index > targetIndex; index--) {
    const inverse = Array<number>(count(revisions[index - 1])).fill(-1);
    edge(revisions[index - 1], revisions[index]).forEach((source, current) => { if (source >= 0) inverse[source] = mapping[current]; });
    mapping = inverse;
  }
  return mapping;
}

/** Missing points remove an entire object for this revision; its old revision snapshot remains intact. */
export function remapSourcePoints(points: readonly (readonly number[])[], mapping: readonly number[], previousCount: number): number[][] | null {
  validateAtomProvenance(mapping, previousCount, mapping.length, false);
  const inverse = new Map<number, number>();
  mapping.forEach((source, target) => { if (source >= 0) inverse.set(source, target); });
  if (points.length < 1 || points.length > 8 || previousCount > 256 || mapping.length > 256
    || points.reduce((sum, point) => sum + point.length, 0) > 1024) throw new Error("The source points are invalid.");
  const remapped = points.map(point => {
    if (!point.length || point.length > 256 || new Set(point).size !== point.length
      || point.some(index => !Number.isInteger(index) || index < 0 || index >= previousCount)) throw new Error("The source atoms are invalid.");
    return point.map(source => inverse.get(source) ?? -1);
  });
  return remapped.some(point => point.includes(-1)) ? null : remapped;
}

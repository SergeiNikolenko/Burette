import { useSyncExternalStore } from "react";
import type { ViewerDocument } from "../../types";

/**
 * The editable source a restored MOLX scene carries. The document stays a `.molx` scene;
 * Text, Geometry and the source editor read and edit this text instead of the archive,
 * and their edits move the restored structure in place (see use-source-editing).
 */
export type LogicalSource = { documentId: string; extension: "xyz" | "sdf"; text: string };

const logical = new Map<string, LogicalSource>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function logicalSourceFor(documentId: string | null | undefined) {
  return documentId ? logical.get(documentId) ?? null : null;
}

/** The logical source as a store snapshot, so a restore that completes after mount re-renders. */
export function useLogicalSource(documentId: string | null | undefined) {
  return useSyncExternalStore(subscribe, () => logicalSourceFor(documentId));
}

/** The extension of the text the document is edited as: its logical source, else its own. */
export function sourceExtension(document: Pick<ViewerDocument, "id" | "extension">) {
  return logical.get(document.id)?.extension ?? document.extension.replace(/^\./u, "").toLowerCase();
}

// Durable identity: a document keeps one UUID for every scene saved from it, and a restored
// scene keeps the UUID it was saved with. Runtime document ids stay per window and open.
const documentUuids = new Map<string, string>();
export function documentUuidFor(documentId: string) {
  let uuid = documentUuids.get(documentId);
  if (!uuid) { uuid = crypto.randomUUID(); documentUuids.set(documentId, uuid); }
  return uuid;
}

// Atom ids per source revision object. A revision (from the scientific source store) keeps the
// ids it was given, so Undo back to it returns them. Documents without revisions keep one
// baseline per element sequence; an edit that changes the atoms has no mapping and no ids.
const revisionAtomIds = new WeakMap<object, readonly string[] | null>();
const plainIds = new Map<string, { elements: string; ids: readonly string[] }>();

export type AtomIdRevision = { topology?: number; sourceAtomIndices?: readonly number[] };

const freshIds = (count: number) => Array.from({ length: count }, () => crypto.randomUUID());

/**
 * Ids of the atoms of `revisions[position]`. The first revision owns the document's original
 * ids (given at restore, else created once). A later revision of the same topology keeps the
 * previous ids; one that changed topology maps them through its `sourceAtomIndices`
 * (−1 for an inserted atom). Without that mapping the ids are unknown (null): new ids are
 * never invented for atoms that may be earlier ones.
 */
export function atomIdsAlong(revisions: readonly AtomIdRevision[], position: number, atomCount: (index: number) => number) {
  let ids: readonly string[] | null = null;
  for (let index = 0; index <= position; index++) {
    const revision = revisions[index];
    if (revisionAtomIds.has(revision)) { ids = revisionAtomIds.get(revision) ?? null; continue; }
    const previous = index > 0 ? revisions[index - 1] : null;
    if (!previous) ids = freshIds(atomCount(index));
    else if (ids && (revision.topology ?? 0) === (previous.topology ?? 0)) ids = ids.length === atomCount(index) ? ids : null;
    else if (ids && revision.sourceAtomIndices && revision.sourceAtomIndices.length === atomCount(index)) {
      const earlier: readonly string[] = ids;
      ids = revision.sourceAtomIndices.map((source) => (source >= 0 && source < earlier.length ? earlier[source] : crypto.randomUUID()));
    } else ids = null;
    revisionAtomIds.set(revision, ids);
  }
  return ids;
}

export function rememberRevisionAtomIds(revision: object, ids: readonly string[] | null) {
  revisionAtomIds.set(revision, ids);
}

/** Ids for a document without revisions: kept while its atoms keep their elements in order. */
export function plainAtomIds(documentId: string, elements: readonly string[]): readonly string[] | null {
  const key = elements.join(" ");
  const known = plainIds.get(documentId);
  if (!known) {
    const ids = freshIds(elements.length);
    plainIds.set(documentId, { elements: key, ids });
    return ids;
  }
  return known.elements === key ? known.ids : null;
}

/** Installs a restored scene's source and identity for its new runtime document, all at once. */
export function adoptLogicalSource(source: LogicalSource, documentUuid: string, atomIds: readonly string[] | null, elements: readonly string[]) {
  documentUuids.set(source.documentId, documentUuid);
  // A scene saved without ids stays without them; its atoms are not given new ones.
  plainIds.set(source.documentId, atomIds ? { elements: elements.join(" "), ids: atomIds } : { elements: "", ids: [] });
  logical.set(source.documentId, source);
  changed();
}

// A restore belongs to one open generation, even when a path reuses its runtime id.
const restoreGenerations = new Map<string, object>();
export function beginScienceSessionRestore(documentId: string) {
  const generation = {};
  restoreGenerations.set(documentId, generation);
  return () => restoreGenerations.get(documentId) === generation;
}

/** Drops what belongs to closed documents. Called with the open documents of the window. */
export function releaseClosedScienceSessions(openDocumentIds: ReadonlySet<string>) {
  let released = false;
  for (const id of restoreGenerations.keys()) if (!openDocumentIds.has(id)) restoreGenerations.delete(id);
  for (const id of logical.keys()) if (!openDocumentIds.has(id)) released = logical.delete(id) || released;
  for (const id of documentUuids.keys()) if (!openDocumentIds.has(id)) documentUuids.delete(id);
  for (const id of plainIds.keys()) if (!openDocumentIds.has(id)) plainIds.delete(id);
  if (released) changed();
}

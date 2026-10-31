import { useSyncExternalStore } from "react";
import type { ScientificDocument } from "../molecular-workbench/scientific-types";
import type { McdCompanionOriginal } from "../science-session/mcd-originals";

// Outputs imported through the workbench open as generated XYZ text that carries
// a unique import token, so two imports with the same geometry stay distinct.
// The parsed data applies only to exactly one revision's text; any other edit of
// the document leaves it without that data. Edits made through the data itself
// (Z-matrix variables) add revisions, in order, so Undo and Redo return to them.
// The uploaded file itself stays with the document, edited or not, so it can be
// saved and reopened as it was. Everything is released once every document that
// showed it has closed, and dropped at once when the open fails.
// A document converted to internal coordinates gets its own `scoped` revisions: its
// text carries no token, so they apply to that document alone.
export type ImportedOriginal = { name: string; file: Blob };
// Revisions with the same `topology` hold the same real atoms in the same order (absent
// for the imported one), so moving between them only moves atoms; between different ones
// the scene is reloaded, because its bonds and selection index the atoms.
// `sourceAtomIndices` maps each atom of a revision that changed topology to its index in the
// previous revision (−1 for an inserted atom), so durable atom ids follow it (science-session/state).
export type ImportedRevision = { text: string; document: ScientificDocument; topology?: number; sourceAtomIndices?: readonly number[]; readonly retainedScienceFrom?: ImportedRevision };
type ImportedSource = { revisions: readonly ImportedRevision[]; original: ImportedOriginal | null; companions?: readonly McdCompanionOriginal[]; documentIds: Set<string>; scoped: boolean };
const REVISION_LIMIT = 100;
const imported = new Map<string, ImportedSource>();
const importListeners = new Set<() => void>();
function importsChanged() {
  importListeners.forEach((listener) => listener());
}
export function subscribeImports(listener: () => void) {
  importListeners.add(listener);
  return () => { importListeners.delete(listener); };
}

export function newImportToken() {
  return `import-${crypto.randomUUID().slice(0, 8)}`;
}

const retainCompanions = (values: readonly McdCompanionOriginal[] | undefined) => values?.length ? Object.freeze(values.map(value => Object.freeze({ ...value }))) : undefined;

export function registerImportedScientificSource(token: string, text: string, document: ScientificDocument, original: ImportedOriginal | null = null, companions?: readonly McdCompanionOriginal[]) {
  if (!text.includes(token)) throw new Error("Imported text must carry its import token.");
  imported.set(token, { revisions: [{ text, document }], original, companions: retainCompanions(companions), documentIds: new Set(), scoped: false });
}

/**
 * Gives `text` of an open document the scientific data `document` (a Z-matrix
 * definition of its geometry), edited through revisions like an import. An earlier
 * conversion of the same document is replaced; an import keeps its own revisions.
 */
export function addDocumentInternalCoordinates(documentId: string, text: string, document: ScientificDocument) {
  // A restored scene's original file stays with the document through a conversion.
  let original: ImportedOriginal | null = null;
  let companions: readonly McdCompanionOriginal[] | undefined;
  for (const [key, entry] of imported) {
    if (!entry.scoped || !entry.documentIds.has(documentId)) continue;
    if (!original && entry.original) { original = entry.original; companions = entry.companions; }
    imported.delete(key);
  }
  imported.set(`document:${documentId}`, { revisions: [{ text, document }], original, companions, documentIds: new Set([documentId]), scoped: true });
  importsChanged();
}

/** Ties an import to the document its open created. */
export function claimImportedSource(token: string, documentId: string) {
  imported.get(token)?.documentIds.add(documentId);
  importsChanged();
}

/** Drops an import whose document never opened. */
export function forgetImportedSource(token: string) {
  if (imported.delete(token)) importsChanged();
}

// The entries that may hold this document's text: its own conversion first, then imports.
// A converted import shares its text with the import, and the conversion must win both
// when the document is read and when an edit is recorded.
function entriesFor(documentId: string) {
  const entries = [...imported.values()];
  return [...entries.filter((entry) => entry.scoped && entry.documentIds.has(documentId)), ...entries.filter((entry) => !entry.scoped)];
}

export function registeredRevision(documentId: string, text: string) {
  for (const entry of entriesFor(documentId)) {
    const revision = entry.revisions[revisionIndex(entry.revisions, text)];
    if (revision) return { entry, revision };
  }
  return null;
}

/** Ties the document to the import whose revision its text is. */
export function claimRegisteredRevision(documentId: string, text: string) {
  const found = registeredRevision(documentId, text);
  if (found && !found.entry.documentIds.has(documentId)) {
    found.entry.documentIds.add(documentId);
    importsChanged();
  }
  return Boolean(found);
}

function importFor(documentId: string) {
  for (const entry of imported.values()) if (entry.documentIds.has(documentId) && !entry.scoped) return entry;
  return null;
}

/** The revisions of this document that include `text`. */
function revisionsWith(documentId: string, text: string) {
  for (const entry of entriesFor(documentId)) if (entry.documentIds.has(documentId) && revisionIndex(entry.revisions, text) >= 0) return entry;
  return null;
}

/** Whether a claimed document has host-owned data an ordinary Mol* export cannot carry. */
export function hasScientificSource(documentId: string) {
  for (const entry of imported.values()) {
    if (entry.documentIds.has(documentId) && (entry.revisions.length > 0 || entry.original)) return true;
  }
  return false;
}

function sourceWithOriginal(documentId: string) {
  for (const entry of imported.values()) if (entry.scoped && entry.original && entry.documentIds.has(documentId)) return entry;
  return importFor(documentId);
}
export function importedOriginalFor(documentId: string) { return sourceWithOriginal(documentId)?.original ?? null; }

/**
 * Gives a restored scene's new runtime document its saved revision and original file, as
 * its own (scoped) data: another document with the same text never shares it. The revision
 * is the current one only; earlier revisions were not saved.
 */
export function adoptRestoredScientificSource(documentId: string, revision: ImportedRevision | null, original: ImportedOriginal | null, companions?: readonly McdCompanionOriginal[]) {
  imported.set(`restored:${documentId}`, { revisions: revision ? [revision] : [], original, companions: retainCompanions(companions), documentIds: new Set([documentId]), scoped: true });
  importsChanged();
}

/** Drops a replaced document's restored data and any later internal-coordinate conversion. */
export function releaseScopedScientificSource(documentId: string) {
  let released = false;
  for (const [key, entry] of imported) {
    if (entry.scoped && entry.documentIds.has(documentId)) released = imported.delete(key) || released;
  }
  if (released) importsChanged();
}

/**
 * The scientific state of `text` for a scene export: the revision it is (with every revision
 * before it, oldest first) and the uploaded original. Identities are compared after the
 * export to detect a change while the scene was serialized.
 */
export function scientificStateFor(documentId: string, text: string) {
  const entry = revisionsWith(documentId, text);
  const position = entry ? revisionIndex(entry.revisions, text) : -1;
  const originals = sourceWithOriginal(documentId);
  return {
    revisions: entry ? entry.revisions : null,
    position,
    revision: entry && position >= 0 ? entry.revisions[position] : null,
    original: originals?.original ?? null,
    ...(originals?.companions ? { companions: originals.companions } : {}),
  };
}

/** The position of `text` among revisions; the latest when an edit came back to an earlier text. */
export function revisionIndex(revisions: readonly ImportedRevision[], text: string) {
  for (let index = revisions.length - 1; index >= 0; index--) if (revisions[index].text === text) return index;
  return -1;
}

/**
 * Records an edit made through a document's imported data as the revision after the
 * one whose text it replaces; revisions after that one (a Redo branch) are dropped.
 * Returns the rollback that restores the revisions exactly as they were, Redo branch
 * included, unless they changed since; null when `fromText` is not a revision of this document.
 */
export function recordImportedRevision(documentId: string, fromText: string, revision: ImportedRevision) {
  const entry = revisionsWith(documentId, fromText);
  if (!entry) return null;
  const previous = entry.revisions;
  const recorded = [...previous.slice(0, revisionIndex(previous, fromText) + 1), revision].slice(-REVISION_LIMIT);
  entry.revisions = recorded;
  importsChanged();
  return () => {
    if (entry.revisions !== recorded) return;
    entry.revisions = previous;
    importsChanged();
  };
}

/** The revisions that include `text`, oldest first; the array is replaced on every change (compiler-safe snapshot). */
export function useImportedRevisions(documentId: string | null, text: string) {
  return useSyncExternalStore(subscribeImports, () => (documentId ? revisionsWith(documentId, text)?.revisions ?? null : null));
}

/**
 * The uploaded file a document was imported from; it outlives edits to the generated geometry.
 * The original itself is the store snapshot, so a claim made after mount re-renders with it
 * (a lookup beside an unused version would be memoized per document by the React Compiler).
 */
export function useImportedOriginal(documentId: string | null) {
  return useSyncExternalStore(subscribeImports, () => (documentId ? importedOriginalFor(documentId) : null));
}

/** Releases imported data whose documents have all closed. Called by the dock, which knows the open documents. */
export function releaseClosedImports(openDocumentIds: ReadonlySet<string>) {
  let released = false;
  for (const [token, entry] of imported) {
    // An unclaimed import may still be preparing its document; publication claims it only after open.
    if (!entry.documentIds.size) continue;
    for (const id of entry.documentIds) {
      if (!openDocumentIds.has(id)) { entry.documentIds.delete(id); released = true; }
    }
    if (!entry.documentIds.size) imported.delete(token);
  }
  if (released) importsChanged();
}

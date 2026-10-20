type DocumentIdentity = { id: string; path: string };
type LocationIdentity = { documentId?: string; path: string };
type Entry = { document: DocumentIdentity; index: number };

// Store updates replace these arrays. Weak keys let closed workspaces and their
// documents be collected instead of retaining a second, long-lived registry.
const indexes = new WeakMap<readonly DocumentIdentity[], { ids: Map<string, Entry>; paths: Map<string, Entry> }>();

export function findIndexedDocument<T extends DocumentIdentity>(
  documents: readonly T[], location: LocationIdentity, match: "id-first" | "first" = "id-first",
): T | null {
  let index = indexes.get(documents);
  if (!index) {
    const ids = new Map<string, Entry>();
    const paths = new Map<string, Entry>();
    documents.forEach((document, offset) => {
      const entry = { document, index: offset };
      if (!ids.has(document.id)) ids.set(document.id, entry);
      if (!paths.has(document.path)) paths.set(document.path, entry);
    });
    index = { ids, paths };
    indexes.set(documents, index);
  }
  const id = location.documentId === undefined ? undefined : index.ids.get(location.documentId);
  const path = index.paths.get(location.path);
  // Existing tab/drop callers match the first id OR path; page kinds prefer id.
  const found = match === "first" && id && path ? (id.index < path.index ? id : path) : id ?? path;
  return (found?.document as T | undefined) ?? null;
}

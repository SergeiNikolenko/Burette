import type { ViewerDocument } from "../types";

export function chemicalSpaceSourceMatches(viewer: ViewerDocument, collection: ViewerDocument) {
  const source = viewer.moleculeSource;
  if (source) return source.documentId === collection.id && source.path === collection.path;
  return viewer.path === collection.path
    || viewer.dockingRequest?.ligandPaths.includes(collection.path) === true;
}

export function chemicalSpaceDocument(
  current: ViewerDocument | null,
  documents: ViewerDocument[],
): ViewerDocument | null {
  if (!current) return null;
  if (current.renderer === "grid2d") return current;
  return documents.find(document => document.renderer === "grid2d"
    && chemicalSpaceSourceMatches(current, document)) ?? null;
}

export function moleculeSourceFromMessage(
  body: Record<string, unknown>,
  documents: ViewerDocument[],
): ViewerDocument["moleculeSource"] {
  const source = documents.find(document => document.id === body.documentId && document.renderer === "grid2d");
  const ids = body.sourceRecordIds;
  if (!source || !Array.isArray(ids) || !ids.length || ids.length > 100_000
    || !ids.every(id => Number.isSafeInteger(id) && id >= 0)) return undefined;
  return { documentId: source.id, path: source.path, sourceRecordIds: ids };
}

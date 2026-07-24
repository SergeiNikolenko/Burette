import type { RecentStructure, ViewerDocument } from "../types";

const TEMPORARY_DOCUMENT_PROTOCOLS = [
  "burette-ketcher://",
  "burette-collection://",
  "burette-context://",
  "burette-docking://",
];

const TEMPORARY_VIEWER_SEGMENTS = [
  "/viewer/ketcher/",
  "/viewer/merged/",
];

export function normalizeDocumentPath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

export function isTemporaryDocumentPath(path: string) {
  const normalized = normalizeDocumentPath(path);
  if (!normalized) return false;
  if (TEMPORARY_DOCUMENT_PROTOCOLS.some((protocol) => normalized.startsWith(protocol))) return true;
  return TEMPORARY_VIEWER_SEGMENTS.some((segment) => normalized.includes(segment));
}

export function isPersistentViewerDocument(document: ViewerDocument) {
  return !document.virtual && !isTemporaryDocumentPath(document.path);
}

export function isPersistentRecentStructure(structure: RecentStructure) {
  return !isTemporaryDocumentPath(structure.path);
}

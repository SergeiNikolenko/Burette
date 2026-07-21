import type { RecentStructure } from "../types";
import { isPersistentRecentStructure } from "./temporary-documents";

export const GLOBAL_RECENT_STRUCTURES_STORAGE_KEY = "burrete.recent.structures";

const MAX_GLOBAL_RECENT_STRUCTURES = 100;
let latestRevision = 0;

export type GlobalRecentStructuresSnapshot = {
  revision: number;
  documents: RecentStructure[];
};

function isRecentStructure(value: unknown): value is RecentStructure {
  if (!value || typeof value !== "object") return false;
  const structure = value as Partial<RecentStructure>;
  return typeof structure.path === "string"
    && structure.path.trim().length > 0
    && typeof structure.title === "string"
    && typeof structure.extension === "string"
    && typeof structure.renderer === "string"
    && typeof structure.byteCount === "number"
    && Number.isFinite(structure.byteCount)
    && structure.byteCount >= 0
    && typeof structure.openedAt === "number"
    && Number.isFinite(structure.openedAt);
}

export function normalizeGlobalRecentStructures(values: unknown[]): RecentStructure[] {
  const byPath = new Map<string, RecentStructure>();
  for (const value of values) {
    if (!isRecentStructure(value) || !isPersistentRecentStructure(value)) continue;
    const previous = byPath.get(value.path);
    if (!previous || previous.openedAt <= value.openedAt) byPath.set(value.path, value);
  }
  return Array.from(byPath.values())
    .sort((left, right) => right.openedAt - left.openedAt)
    .slice(0, MAX_GLOBAL_RECENT_STRUCTURES);
}

function parsedSnapshot(serialized: string): GlobalRecentStructuresSnapshot {
  const parsed: unknown = JSON.parse(serialized);
  if (Array.isArray(parsed)) {
    return { revision: 0, documents: normalizeGlobalRecentStructures(parsed) };
  }
  if (!parsed || typeof parsed !== "object") return { revision: 0, documents: [] };
  const candidate = parsed as Partial<GlobalRecentStructuresSnapshot>;
  const revision = typeof candidate.revision === "number"
    && Number.isSafeInteger(candidate.revision)
    && candidate.revision >= 0
    ? candidate.revision
    : 0;
  return {
    revision,
    documents: normalizeGlobalRecentStructures(Array.isArray(candidate.documents) ? candidate.documents : []),
  };
}

function storedSnapshot(): GlobalRecentStructuresSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  const serialized = localStorage.getItem(GLOBAL_RECENT_STRUCTURES_STORAGE_KEY);
  if (serialized === null) return null;
  try {
    return parsedSnapshot(serialized);
  } catch {
    return { revision: 0, documents: [] };
  }
}

export function loadGlobalRecentStructuresSnapshot(): GlobalRecentStructuresSnapshot | null {
  const snapshot = storedSnapshot();
  if (!snapshot || snapshot.revision < latestRevision) return null;
  latestRevision = snapshot.revision;
  return snapshot;
}

export function loadGlobalRecentStructures(): RecentStructure[] | null {
  return loadGlobalRecentStructuresSnapshot()?.documents ?? null;
}

export function globalRecentStructuresRevision() {
  const storedRevision = storedSnapshot()?.revision ?? 0;
  latestRevision = Math.max(latestRevision, storedRevision);
  return latestRevision;
}

export function saveGlobalRecentStructures(
  structures: RecentStructure[],
  revision = globalRecentStructuresRevision(),
) {
  if (typeof localStorage === "undefined") return;
  const nextRevision = Math.max(latestRevision, revision);
  latestRevision = nextRevision;
  try {
    localStorage.setItem(
      GLOBAL_RECENT_STRUCTURES_STORAGE_KEY,
      JSON.stringify({
        revision: nextRevision,
        documents: normalizeGlobalRecentStructures(structures),
      } satisfies GlobalRecentStructuresSnapshot),
    );
  } catch {
    // Recent files are optional state; storage failures must not block opening a document.
  }
}

export function applyGlobalRecentStructuresSnapshot(
  snapshot: GlobalRecentStructuresSnapshot,
): RecentStructure[] | null {
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) return null;
  const storageRevision = storedSnapshot()?.revision ?? 0;
  if (snapshot.revision < Math.max(latestRevision, storageRevision)) return null;
  const documents = normalizeGlobalRecentStructures(snapshot.documents);
  latestRevision = snapshot.revision;
  saveGlobalRecentStructures(documents, snapshot.revision);
  return documents;
}

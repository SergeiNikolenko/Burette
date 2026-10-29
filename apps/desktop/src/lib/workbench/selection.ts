import { useSyncExternalStore } from "react";

/**
 * Atoms the user selected in a document's 3D view, as source-file atom indices.
 * The viewer reports at most 96 atom identities; `count` is the full selection
 * size, so `truncated` tells when the indices cover only part of it.
 */
export type ViewerAtomSelection = { atoms: readonly number[]; count: number; truncated: boolean };

const selections = new Map<string, ViewerAtomSelection>();
const listeners = new Set<() => void>();
const MAX_DOCUMENTS = 64;
const MAX_IDENTITIES = 96;

function readAtoms(identities: unknown) {
  if (!Array.isArray(identities)) return [];
  const atoms = new Set<number>();
  for (let offset = 0; offset < Math.min(identities.length, MAX_IDENTITIES); offset++) {
    const identity = identities[offset];
    if (!identity || typeof identity !== "object") continue;
    const { sourceIndex, atomIndex } = identity as { sourceIndex?: unknown; atomIndex?: unknown };
    const index = Number(sourceIndex ?? atomIndex);
    if (Number.isSafeInteger(index) && index >= 0) atoms.add(index);
  }
  return [...atoms].sort((a, b) => a - b);
}

/** Called with the viewer's `selectionChanged` payload for one document. */
export function rememberViewerAtomSelection(documentId: string, selection: Record<string, unknown> | null) {
  const identities = selection?.atomIdentities;
  const atoms = readAtoms(identities);
  const declaredCount = Number(selection?.atoms);
  const count = Math.max(atoms.length, Number.isSafeInteger(declaredCount) && declaredCount >= 0 ? declaredCount : atoms.length);
  const previous = selections.get(documentId);
  if (!atoms.length && !previous) return;
  selections.delete(documentId);
  if (atoms.length) {
    selections.set(documentId, { atoms, count, truncated: Boolean(selection?.truncated) || count > atoms.length || (Array.isArray(identities) && identities.length > MAX_IDENTITIES) });
    if (selections.size > MAX_DOCUMENTS) selections.delete(selections.keys().next().value!);
  }
  listeners.forEach((listener) => listener());
}

/** Drops a document's selection when its scene is replaced, so atoms of the old scene are never edited. */
export function forgetViewerAtomSelection(documentId: string) {
  if (selections.delete(documentId)) listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useViewerAtomSelection(documentId: string | null) {
  return useSyncExternalStore(subscribe, () => (documentId ? selections.get(documentId) ?? null : null));
}

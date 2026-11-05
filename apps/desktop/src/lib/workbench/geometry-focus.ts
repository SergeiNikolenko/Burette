import { useSyncExternalStore } from "react";

/** A 3D measurement the Geometry panel should bring into view, in source atom order. */
export type GeometryFocusRequest = { documentId: string; atoms: number[]; id: number };

let current: GeometryFocusRequest | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

export function requestGeometryFocus(documentId: string, atoms: number[]) {
  current = { documentId, atoms: [...atoms], id: nextId++ };
  for (const listener of listeners) listener();
}

/**
 * The row and column that hold a measurement, read in either direction: a distance,
 * angle or dihedral is the row of one end measured from the following atoms.
 */
export function measurementCell(rows: readonly { refs: readonly number[]; values: readonly unknown[] }[], atoms: readonly number[]) {
  const slot = atoms.length - 2;
  for (const [atom, ...refs] of [atoms, [...atoms].reverse()]) {
    const row = rows[atom];
    if (row && slot < row.values.length && refs.every((ref, index) => row.refs[index] === ref)) return { row: atom, slot };
  }
  return null;
}

export const MEASUREMENT_NOUNS = ["distance", "angle", "dihedral"] as const;

/** A handled request is dropped, so reopening Geometry later does not jump again. */
export function consumeGeometryFocus(id: number) {
  if (current?.id === id) current = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The latest request for this document; each request has its own id so a repeat still applies. */
export function useGeometryFocusRequest(documentId: string) {
  const request = useSyncExternalStore(subscribe, () => current, () => null);
  return request?.documentId === documentId ? request : null;
}

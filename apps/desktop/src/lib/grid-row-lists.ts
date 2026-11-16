import { useSyncExternalStore } from "react";

// Row lists: named selections of a collection, DataWarrior's row lists. A list
// holds the source indexes of its rows, which is what the grid selects and
// filters by. An SD file has no place for them, so they are kept per file path
// in this browser's storage and come back when the file is opened again.

export type RowList = { id: string; name: string; indexes: number[] };

const STORAGE_KEY = "burette.grid.row-lists.v1";
const MAX_LISTS_PER_DOCUMENT = 50;
const MAX_DOCUMENTS = 200;
const MAX_NAME_CHARS = 80;
/** The grid hands over at most this many selected rows. */
export const MAX_ROW_LIST_ROWS = 100_000;

/** "0-4,7,9-10": a saved selection is mostly runs of neighbouring rows. */
export function encodeRowRanges(indexes: readonly number[]) {
  const sorted = [...new Set(indexes.filter((index) => Number.isSafeInteger(index) && index >= 0))].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    parts.push(end > start ? `${sorted[start]}-${sorted[end]}` : String(sorted[start]));
    start = end + 1;
  }
  return parts.join(",");
}

export function decodeRowRanges(text: string) {
  const indexes: number[] = [];
  for (const part of text.split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/u.exec(part.trim());
    if (!match) continue;
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first) continue;
    for (let index = first; index <= last && indexes.length < MAX_ROW_LIST_ROWS; index += 1) indexes.push(index);
  }
  return indexes;
}

type Stored = Record<string, Array<{ id: string; name: string; rows: string }>>;

const EMPTY: RowList[] = [];
let lists: Map<string, RowList[]> | null = null;
const listeners = new Set<() => void>();

function load() {
  if (lists) return lists;
  lists = new Map();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Stored;
    for (const [documentKey, entries] of Object.entries(stored)) {
      if (!Array.isArray(entries)) continue;
      const restored = entries.flatMap((entry) => {
        if (typeof entry?.id !== "string" || typeof entry.name !== "string" || typeof entry.rows !== "string") return [];
        const indexes = decodeRowRanges(entry.rows);
        return indexes.length ? [{ id: entry.id, name: entry.name.slice(0, MAX_NAME_CHARS), indexes }] : [];
      });
      if (restored.length) lists.set(documentKey, restored.slice(0, MAX_LISTS_PER_DOCUMENT));
    }
  } catch { /* unreadable storage: start without lists */ }
  return lists;
}

function commit(documentKey: string, next: RowList[]) {
  const all = load();
  // Re-inserting moves the document to the end, so the oldest untouched one is dropped first.
  all.delete(documentKey);
  if (next.length) all.set(documentKey, next);
  while (all.size > MAX_DOCUMENTS) all.delete(all.keys().next().value as string);
  try {
    const stored: Stored = {};
    for (const [key, entries] of all) {
      stored[key] = entries.map((entry) => ({ id: entry.id, name: entry.name, rows: encodeRowRanges(entry.indexes) }));
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch { /* storage full or unavailable: the lists last for this session */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function rowListsFor(documentKey: string): RowList[] {
  return load().get(documentKey) ?? EMPTY;
}

export function useRowLists(documentKey: string) {
  return useSyncExternalStore(subscribe, () => rowListsFor(documentKey), () => EMPTY);
}

/** "List 1", "List 2", …: the first number no list of the document uses yet. */
export function nextRowListName(existing: readonly RowList[]) {
  const names = new Set(existing.map((list) => list.name));
  for (let number = 1; ; number += 1) {
    if (!names.has(`List ${number}`)) return `List ${number}`;
  }
}

export function saveRowList(documentKey: string, name: string, indexes: readonly number[]): RowList | null {
  const existing = rowListsFor(documentKey);
  const rows = decodeRowRanges(encodeRowRanges(indexes));
  if (rows.length === 0 || existing.length >= MAX_LISTS_PER_DOCUMENT) return null;
  const list = { id: crypto.randomUUID(), name: name.trim().slice(0, MAX_NAME_CHARS) || nextRowListName(existing), indexes: rows };
  commit(documentKey, [...existing, list]);
  return list;
}

export function renameRowList(documentKey: string, id: string, name: string) {
  const trimmed = name.trim().slice(0, MAX_NAME_CHARS);
  if (!trimmed) return;
  commit(documentKey, rowListsFor(documentKey).map((list) => (list.id === id ? { ...list, name: trimmed } : list)));
}

export function deleteRowList(documentKey: string, id: string) {
  commit(documentKey, rowListsFor(documentKey).filter((list) => list.id !== id));
}

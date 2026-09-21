import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

// Both dock locations subscribe to the same collection settings. Retain a small
// session LRU across unmounts without retaining molecular result payloads.
const settings = new Map<string, Map<string, unknown>>();
const listeners = new Map<string, Set<() => void>>();
const MAX_COLLECTIONS = 12;

export function useChemicalSpaceSetting<T>(documentKey: string, field: string, initial: T) {
  const subscribe = useCallback((notify: () => void) => {
    let subscribers = listeners.get(documentKey);
    if (!subscribers) listeners.set(documentKey, subscribers = new Set());
    subscribers.add(notify);
    return () => {
      subscribers.delete(notify);
      if (!subscribers.size) listeners.delete(documentKey);
    };
  }, [documentKey]);
  const getSnapshot = useCallback(
    () => {
      const collection = settings.get(documentKey);
      return collection?.has(field) ? collection.get(field) as T : initial;
    },
    [documentKey, field, initial],
  );
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setValue = useCallback((update: SetStateAction<T>) => {
    let collection = settings.get(documentKey);
    const previous = collection?.has(field) ? collection.get(field) as T : initial;
    const next = typeof update === "function" ? (update as (value: T) => T)(previous) : update;
    if (Object.is(previous, next)) return;
    if (!collection) collection = new Map();
    collection.set(field, next);
    settings.delete(documentKey);
    settings.set(documentKey, collection);
    for (const key of settings.keys()) {
      if (settings.size <= MAX_COLLECTIONS) break;
      if (!listeners.has(key)) settings.delete(key);
    }
    listeners.get(documentKey)?.forEach((notify) => notify());
  }, [documentKey, field, initial]);
  return [value, setValue] as const;
}

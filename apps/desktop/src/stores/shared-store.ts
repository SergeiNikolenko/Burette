import type { StateCreator } from "zustand";
import type {} from "zustand/middleware";

// These stores use synchronous localStorage persistence. Refresh before each
// action as storage events can still be queued when another window writes.
export function refreshSharedActions<T>(
  creator: StateCreator<T, [["zustand/persist", unknown]], []>,
): StateCreator<T, [["zustand/persist", unknown]], []> {
  return (set, get, api) => {
    const update: typeof set = (partial, replace) => {
      void api.persist.rehydrate();
      if (replace) set(partial as T, true);
      else set(partial, false);
    };
    return creator(update, get, api);
  };
}

type SharedStore = {
  persist: {
    getOptions: () => { name?: string };
    rehydrate: () => void | Promise<void>;
  };
};

export function observeSharedStore(store: SharedStore) {
  if (typeof window === "undefined" || !window.addEventListener) return () => {};
  const refresh = () => { void store.persist.rehydrate(); };
  const storage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage &&
        (event.key === null || event.key === store.persist.getOptions().name)) refresh();
  };
  window.addEventListener("storage", storage);
  window.addEventListener("focus", refresh);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener("focus", refresh);
  };
}

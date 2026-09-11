type WorkspaceStorageKeyOptions = {
  windowScoped?: boolean;
};

function currentWindowStorageSuffix() {
  if (typeof window === "undefined" || !window.location) return "";
  const windowLabel = new URLSearchParams(window.location.search).get("buretteWindow")?.trim() ?? "";
  if (!windowLabel || windowLabel === "main") return "";
  return `.${windowLabel.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

export function workspaceStorageKey(baseKey: string, options: WorkspaceStorageKeyOptions = {}) {
  if (options.windowScoped === false) return baseKey;
  return `${baseKey}${currentWindowStorageSuffix()}`;
}

type StorageLike = Pick<Storage, "length" | "key" | "removeItem">;

/**
 * Removes every persisted key that belongs to the current secondary window,
 * so a closed window does not leave its tab workspace or molecule session
 * behind. The main window carries no suffix and keeps its keys.
 */
export function clearWindowScopedStorage(storage?: StorageLike) {
  const suffix = currentWindowStorageSuffix();
  if (!suffix) return [];
  const target = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!target) return [];
  const keys: string[] = [];
  try {
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index);
      if (key?.endsWith(suffix)) keys.push(key);
    }
    for (const key of keys) target.removeItem(key);
  } catch (error) {
    console.warn("Window-scoped storage cleanup failed", error);
  }
  return keys;
}

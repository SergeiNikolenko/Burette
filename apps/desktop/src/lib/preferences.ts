const STORAGE_PREFIX = "burrete.preference.";

export async function getPreference<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export async function setPreference<T>(key: string, value: T): Promise<void> {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Non-browser tests and privacy-restricted runtimes can ignore persistence.
  }
}

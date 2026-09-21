import { registerThumbnailTestReset } from "./thumbnail-test-reset";

export interface ThumbnailCacheEntry<T> {
  promise: Promise<T>;
  status: "pending" | "resolved" | "rejected";
  value?: T;
  onResolve?: (value: T) => void;
}

export interface ThumbnailCacheStore<T> {
  get(key: string): ThumbnailCacheEntry<T> | undefined;
  set(key: string, entry: ThumbnailCacheEntry<T>): void;
  delete(key: string): boolean;
  clear?(): void;
  prune?(): void;
}

export interface ThumbnailArtifactCacheOptions<T> {
  maxEntries: number;
  dispose?: (value: T) => void;
}

export interface ThumbnailArtifactCache<T> extends ThumbnailCacheStore<T> {
  readonly size: number;
  clear(): void;
  prune(): void;
}

export function cachedThumbnailResource<T>(
  cache: ThumbnailCacheStore<T>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key);
  if (cached) {
    if (cached.status === "rejected") {
      cache.delete(key);
    }
    return cached.promise;
  }

  const entry: ThumbnailCacheEntry<T> = {
    status: "pending",
    promise: load().then(
      (value) => {
        entry.status = "resolved";
        entry.value = value;
        entry.onResolve?.(value);
        cache.prune?.();
        return value;
      },
      (error) => {
        entry.status = "rejected";
        throw error;
      },
    ),
  };
  cache.set(key, entry);
  return entry.promise;
}

export function createThumbnailArtifactCache<T>({
  maxEntries,
  dispose,
}: ThumbnailArtifactCacheOptions<T>): ThumbnailArtifactCache<T> {
  const entries = new Map<string, ThumbnailCacheEntry<T>>();

  const cache: ThumbnailArtifactCache<T> = {
    get size() {
      return entries.size;
    },
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry;
    },
    set(key, entry) {
      entries.set(key, entry);
      entry.onResolve = (value) => {
        if (entries.get(key) !== entry) dispose?.(value);
      };
      cache.prune?.();
    },
    delete(key) {
      const entry = entries.get(key);
      if (!entry) return false;
      entries.delete(key);
      disposeCacheEntry(entry, dispose);
      return true;
    },
    clear() {
      for (const entry of entries.values()) {
        disposeCacheEntry(entry, dispose);
      }
      entries.clear();
    },
    prune() {
      while (entries.size > maxEntries) {
        const evicted = evictOldestResolvedEntry(entries, dispose);
        if (!evicted) return;
      }
    },
  };

  registerThumbnailTestReset(() => cache.clear?.());

  return cache;
}

function evictOldestResolvedEntry<T>(
  entries: Map<string, ThumbnailCacheEntry<T>>,
  dispose?: (value: T) => void,
): boolean {
  for (const [key, entry] of entries) {
    if (entry.status !== "pending") {
      entries.delete(key);
      disposeCacheEntry(entry, dispose);
      return true;
    }
  }
  return false;
}

function disposeCacheEntry<T>(
  entry: ThumbnailCacheEntry<T>,
  dispose?: (value: T) => void,
) {
  if (entry.status === "resolved" && entry.value !== undefined) {
    dispose?.(entry.value);
  }
}

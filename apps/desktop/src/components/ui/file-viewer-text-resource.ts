import type {
  ViewerContentIdentity,
  ViewerContentText,
} from "@/lib/viewer-resource";

import {
  abortError,
  isAbortError,
  subscribeToAbortableRequest,
  type SharedAbortableRequest,
} from "./viewer-abortable-request";
import { lruGet } from "./viewer-lru-cache";

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const on =
    typeof globalThis !== "undefined" &&
    (globalThis as { __FILE_VIEWER_PROFILE__?: boolean })
      .__FILE_VIEWER_PROFILE__;
  if (!on) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    console.log(
      `[file-viewer] ${label} ${(performance.now() - t0).toFixed(1)}ms`,
    );
  }
}

export interface TextResourceSubscription {
  content: ViewerContentIdentity & ViewerContentText;
  fileName: string;
  signal: AbortSignal;
}

export interface TextResourceCache {
  load(sub: TextResourceSubscription): Promise<string>;
  clear(): void;
  size(): number;
}

export function createTextResourceCache(maxEntries = 12): TextResourceCache {
  const requests = new Map<string, SharedAbortableRequest<string>>();

  function remove(contentKey: string) {
    requests.delete(contentKey);
  }

  function pruneInactiveEntries() {
    while (requests.size > maxEntries) {
      let pruned = false;
      for (const [contentKey, entry] of requests) {
        if (!entry.settled && entry.subscribers.size > 0) continue;
        requests.delete(contentKey);
        if (!entry.settled) entry.controller.abort();
        pruned = true;
        break;
      }
      if (!pruned) break;
    }
  }

  function entryFor({
    content,
    fileName,
  }: TextResourceSubscription): SharedAbortableRequest<string> {
    const contentKey = content.key;
    const existingEntry = lruGet(requests, contentKey);
    if (existingEntry) return existingEntry;

    const controller = new AbortController();
    let entry: SharedAbortableRequest<string> | null = null;
    const promise = timed(`text:fetch ${fileName}`, () =>
      content.readText({ signal: controller.signal }),
    )
      .catch((error: unknown) => {
        if (!isAbortError(error)) requests.delete(contentKey);
        throw error;
      })
      .finally(() => {
        if (entry) {
          entry.settled = true;
          pruneInactiveEntries();
        }
      });

    entry = {
      controller,
      promise,
      subscriberPromises: new WeakMap(),
      subscribers: new Set(),
      settled: false,
    };

    requests.set(contentKey, entry);
    return entry;
  }

  return {
    load(sub) {
      if (sub.signal.aborted) return Promise.reject(abortError());

      const contentKey = sub.content.key;
      const entry = entryFor(sub);
      const promise = subscribeToAbortableRequest(entry, sub.signal, () =>
        remove(contentKey),
      );
      pruneInactiveEntries();
      return promise;
    },
    clear() {
      for (const entry of requests.values()) entry.controller.abort();
      requests.clear();
    },
    size() {
      return requests.size;
    },
  };
}

export const textResource = createTextResourceCache();

export function loadTextResource(
  sub: TextResourceSubscription,
): Promise<string> {
  return textResource.load(sub);
}

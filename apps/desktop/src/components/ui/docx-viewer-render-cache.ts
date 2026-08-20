import { lruGet, lruSet } from "./viewer-lru-cache";

export const DOCX_RENDER_CACHE_MAX_ENTRIES = 4;

export type DocxPageSize = readonly [number, number];

export interface DocxRenderCacheEntry {
  pageSizes: readonly DocxPageSize[];
  renderHost: HTMLElement;
}

export interface DocxRenderCacheHit {
  pageSizes: readonly DocxPageSize[];
  renderHost: HTMLElement;
}

const UNSAFE_DOCX_RENDER_CACHE_SELECTOR =
  "audio, canvas, embed, iframe, object, video";

const docxRenderCache = new Map<string, DocxRenderCacheEntry>();
const pendingDocxRenderCache = new Map<
  string,
  Promise<DocxRenderCacheEntry | null>
>();

export function readDocxRenderCache(key: string): DocxRenderCacheHit | null {
  const entry = lruGet(docxRenderCache, key);
  return entry ? cloneDocxRenderCacheEntry(entry) : null;
}

export function readPendingDocxRenderCache(
  key: string,
): Promise<DocxRenderCacheEntry | null> | null {
  return pendingDocxRenderCache.get(key) ?? null;
}

export function writePendingDocxRenderCache(
  key: string,
  promise: Promise<DocxRenderCacheEntry | null>,
) {
  pendingDocxRenderCache.set(key, promise);
  void promise
    .finally(() => {
      if (pendingDocxRenderCache.get(key) === promise) {
        pendingDocxRenderCache.delete(key);
      }
    })
    .catch(() => undefined);
}

export function writeDocxRenderCache({
  key,
  pageSizes,
  renderHost,
}: {
  key: string;
  pageSizes: readonly DocxPageSize[];
  renderHost: HTMLElement;
}): DocxRenderCacheEntry | null {
  if (
    pageSizes.length === 0 ||
    !renderHost.querySelector(".docx-wrapper > section.docx")
  ) {
    return null;
  }
  if (!canCacheDocxRenderHost(renderHost)) return null;

  const cachedRenderHost = renderHost.cloneNode(true);
  if (!(cachedRenderHost instanceof HTMLElement)) return null;

  const entry: DocxRenderCacheEntry = {
    pageSizes,
    renderHost: cachedRenderHost,
  };
  lruSet(docxRenderCache, key, entry, undefined, DOCX_RENDER_CACHE_MAX_ENTRIES);
  return entry;
}

export function cloneDocxRenderCacheEntry(
  entry: DocxRenderCacheEntry,
): DocxRenderCacheHit {
  return {
    pageSizes: entry.pageSizes,
    renderHost: entry.renderHost.cloneNode(true) as HTMLElement,
  };
}

export function resetDocxRenderCacheForTests() {
  docxRenderCache.clear();
  pendingDocxRenderCache.clear();
}

function canCacheDocxRenderHost(renderHost: HTMLElement) {
  return !renderHost.querySelector(UNSAFE_DOCX_RENDER_CACHE_SELECTOR);
}

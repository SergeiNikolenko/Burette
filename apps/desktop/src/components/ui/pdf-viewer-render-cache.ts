import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

export const PDF_RENDERED_PAGE_CACHE_MAX_ENTRIES = 16;
export const PDF_RENDERED_PAGE_CACHE_MAX_PIXELS = 24_000_000;
// Only close lower-resolution renders of the same page may be stretched as
// resize previews; thumbnail-resolution bitmaps below this ratio would blur.
export const PDF_RENDERED_PAGE_PREVIEW_MIN_SCALE_RATIO = 0.5;

export type PdfRenderedPageSignature = {
  documentKey: string;
  pageNumber: number;
  scale: number;
  rotation: number;
  devicePixelRatio: number;
  viewportWidth: number;
  viewportHeight: number;
};

export type PdfRenderedPageCache = {
  clock: number;
  entries: Map<string, PdfRenderedPageCacheEntry>;
  resetKey: unknown;
};

export type PdfRenderedPageCacheEntry = PdfRenderedPageSignature & {
  canvas: HTMLCanvasElement;
  lastUsed: number;
  pixels: number;
};

type PdfRenderedPageCacheRecord = {
  cache: PdfRenderedPageCache;
  retainCount: number;
  resetKey: unknown;
};

const objectCacheRecords = new WeakMap<object, PdfRenderedPageCacheRecord>();
const primitiveCacheRecords = new Map<unknown, PdfRenderedPageCacheRecord>();

export function createPdfRenderedPageCache(
  resetKey: unknown,
): PdfRenderedPageCache {
  return {
    clock: 0,
    entries: new Map(),
    resetKey,
  };
}

export function usePdfRenderedPageCache(resetKey: unknown) {
  const record = getPdfRenderedPageCacheRecord(resetKey);

  useKeyedMountEffect(joinEffectKey([record]), () => {
    record.retainCount += 1;
    return () => releasePdfRenderedPageCacheRecord(record);
  });

  return record.cache;
}

export function readPdfRenderedPageCache(
  cache: PdfRenderedPageCache | undefined,
  requested: PdfRenderedPageSignature,
) {
  if (!cache) return null;

  let bestEntry: PdfRenderedPageCacheEntry | null = null;
  for (const entry of cache.entries.values()) {
    if (!doesRenderedPageSatisfyRequest(entry, requested)) continue;
    if (
      !bestEntry ||
      entry.pixels < bestEntry.pixels ||
      (entry.pixels === bestEntry.pixels && entry.lastUsed > bestEntry.lastUsed)
    ) {
      bestEntry = entry;
    }
  }

  if (!bestEntry) return null;
  cache.clock += 1;
  bestEntry.lastUsed = cache.clock;
  return bestEntry;
}

export function readPdfRenderedPageCachePreview(
  cache: PdfRenderedPageCache | undefined,
  requested: PdfRenderedPageSignature,
) {
  if (!cache) return null;

  let bestEntry: PdfRenderedPageCacheEntry | null = null;
  for (const entry of cache.entries.values()) {
    if (!doesRenderedPageMatchPreview(entry, requested)) continue;
    if (!bestEntry || entry.pixels > bestEntry.pixels) {
      bestEntry = entry;
    }
  }

  if (!bestEntry) return null;
  cache.clock += 1;
  bestEntry.lastUsed = cache.clock;
  return bestEntry;
}

export function writePdfRenderedPageCache({
  cache,
  rendered,
  sourceCanvas,
}: {
  cache: PdfRenderedPageCache | undefined;
  rendered: PdfRenderedPageSignature;
  sourceCanvas: HTMLCanvasElement;
}) {
  if (!cache || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) return;

  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const context = canvas.getContext("2d");
  if (!context || typeof context.drawImage !== "function") return;

  context.drawImage(sourceCanvas, 0, 0);
  cache.clock += 1;
  const key = getPdfRenderedPageCacheKey(rendered);
  cache.entries.set(key, {
    ...rendered,
    canvas,
    lastUsed: cache.clock,
    pixels: canvas.width * canvas.height,
  });
  evictPdfRenderedPageCache(cache, key);
}

export function clearPdfRenderedPageCache(cache: PdfRenderedPageCache) {
  cache.clock = 0;
  cache.entries.clear();
}

function evictPdfRenderedPageCache(
  cache: PdfRenderedPageCache,
  retainedKey: string,
) {
  let totalPixels = getTotalCachedPixels(cache);

  while (
    cache.entries.size > PDF_RENDERED_PAGE_CACHE_MAX_ENTRIES ||
    totalPixels > PDF_RENDERED_PAGE_CACHE_MAX_PIXELS
  ) {
    const evicted = findPdfRenderedPageCacheEviction(cache, retainedKey);
    if (!evicted) return;

    totalPixels -= evicted.entry.pixels;
    cache.entries.delete(evicted.key);
  }
}

function findPdfRenderedPageCacheEviction(
  cache: PdfRenderedPageCache,
  retainedKey: string,
) {
  let oldest: { key: string; entry: PdfRenderedPageCacheEntry } | null = null;

  for (const [key, entry] of cache.entries) {
    if (key === retainedKey) continue;
    if (!oldest || entry.lastUsed < oldest.entry.lastUsed) {
      oldest = { key, entry };
    }
  }

  return oldest;
}

function getTotalCachedPixels(cache: PdfRenderedPageCache) {
  let pixels = 0;
  for (const entry of cache.entries.values()) {
    pixels += entry.pixels;
  }
  return pixels;
}

function doesRenderedPageSatisfyRequest(
  rendered: PdfRenderedPageSignature,
  requested: PdfRenderedPageSignature,
) {
  return (
    rendered.documentKey === requested.documentKey &&
    rendered.pageNumber === requested.pageNumber &&
    rendered.rotation === requested.rotation &&
    rendered.scale >= requested.scale &&
    rendered.viewportWidth >= requested.viewportWidth &&
    rendered.viewportHeight >= requested.viewportHeight &&
    hasMatchingPageAspectRatio(rendered, requested) &&
    rendered.devicePixelRatio >= requested.devicePixelRatio
  );
}

function doesRenderedPageMatchPreview(
  rendered: PdfRenderedPageSignature,
  requested: PdfRenderedPageSignature,
) {
  return (
    rendered.documentKey === requested.documentKey &&
    rendered.pageNumber === requested.pageNumber &&
    rendered.rotation === requested.rotation &&
    rendered.viewportWidth >=
      requested.viewportWidth * PDF_RENDERED_PAGE_PREVIEW_MIN_SCALE_RATIO &&
    rendered.viewportHeight >=
      requested.viewportHeight * PDF_RENDERED_PAGE_PREVIEW_MIN_SCALE_RATIO &&
    hasMatchingPageAspectRatio(rendered, requested)
  );
}

function getPdfRenderedPageCacheKey(rendered: PdfRenderedPageSignature) {
  return [
    rendered.documentKey,
    rendered.pageNumber,
    rendered.scale,
    rendered.rotation,
    rendered.devicePixelRatio,
    rendered.viewportWidth,
    rendered.viewportHeight,
  ].join(":");
}

function getPdfRenderedPageCacheRecord(
  resetKey: unknown,
): PdfRenderedPageCacheRecord {
  const records = isObjectCacheKey(resetKey)
    ? objectCacheRecords
    : primitiveCacheRecords;
  const cached = records.get(resetKey as never);
  if (cached) return cached;

  const record: PdfRenderedPageCacheRecord = {
    cache: createPdfRenderedPageCache(resetKey),
    retainCount: 0,
    resetKey,
  };
  records.set(resetKey as never, record);
  return record;
}

function releasePdfRenderedPageCacheRecord(record: PdfRenderedPageCacheRecord) {
  record.retainCount = Math.max(0, record.retainCount - 1);
  if (record.retainCount > 0) return;

  clearPdfRenderedPageCache(record.cache);
  if (isObjectCacheKey(record.resetKey)) {
    objectCacheRecords.delete(record.resetKey);
  } else {
    primitiveCacheRecords.delete(record.resetKey);
  }
}

function isObjectCacheKey(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function hasMatchingPageAspectRatio(
  rendered: PdfRenderedPageSignature,
  requested: PdfRenderedPageSignature,
) {
  const renderedRatio = rendered.viewportWidth / rendered.viewportHeight;
  const requestedRatio = requested.viewportWidth / requested.viewportHeight;
  return Math.abs(renderedRatio - requestedRatio) < 0.0001;
}

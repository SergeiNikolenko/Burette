import type { ThumbnailFileMeta } from "./thumbnail-text";

/**
 * Profiling helper: logs `[thumb] <label> <ms>` when enabled. Gated on a global
 * so it costs nothing in normal use; the profiler sets it before navigation.
 */
export async function timedThumbnail<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const on =
    typeof globalThis !== "undefined" &&
    (globalThis as { __THUMB_PROFILE__?: boolean }).__THUMB_PROFILE__;
  if (!on) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    console.log(`[thumb] ${label} ${(performance.now() - t0).toFixed(1)}ms`);
  }
}

export function shortName(meta: ThumbnailFileMeta): string {
  return meta.fileName;
}

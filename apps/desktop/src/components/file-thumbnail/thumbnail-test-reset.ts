const resetHandlers = new Set<() => void>();

export function registerThumbnailTestReset(handler: () => void): () => void {
  resetHandlers.add(handler);
  return () => {
    resetHandlers.delete(handler);
  };
}

export function clearThumbnailCachesForTests() {
  for (const reset of [...resetHandlers]) reset();
}

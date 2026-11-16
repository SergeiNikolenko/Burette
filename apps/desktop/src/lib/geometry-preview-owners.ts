// The existing Geometry preview ownership lives here so model reads and edits
// observe one owner. Listeners exist only while a reader waits or holds a guard.
const owners = new Map<string, { token: object; isCurrent: () => boolean }>();
const listeners = new Set<(documentId: string) => void>();
const changed = (documentId: string) => { for (const listener of [...listeners]) listener(documentId); };

export function isGeometryPreviewIdle(documentId: string) {
  const owner = owners.get(documentId);
  return !owner || !owner.isCurrent();
}

export function claimGeometryPreview(documentId: string, token: object, isCurrent: () => boolean) {
  const previous = owners.get(documentId);
  if (previous && previous.token !== token && previous.isCurrent()) return false;
  owners.set(documentId, { token, isCurrent });
  if (previous?.token !== token) changed(documentId);
  return true;
}

export function releaseGeometryPreview(documentId: string, token: object) {
  if (owners.get(documentId)?.token !== token) return;
  owners.delete(documentId);
  changed(documentId);
}

export type GeometryPreviewRead = { isCurrent: () => boolean; release: () => void };

// An idle check after the ACK alone misses claim/release ABA during the read.
// The guard retains that activity until the reader publishes or discards its model.
function guard(documentId: string, signal?: AbortSignal): GeometryPreviewRead {
  let active = true, invalidated = false;
  const invalidate = (id: string) => { if (id === documentId) invalidated = true; };
  listeners.add(invalidate);
  return {
    isCurrent: () => active && !invalidated && !signal?.aborted && isGeometryPreviewIdle(documentId),
    release: () => { active = false; listeners.delete(invalidate); },
  };
}

export async function waitForGeometryPreviewIdle(documentId: string, signal?: AbortSignal): Promise<GeometryPreviewRead> {
  signal?.throwIfAborted();
  if (isGeometryPreviewIdle(documentId)) return guard(documentId, signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => { listeners.delete(wake); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Geometry read cancelled.", "AbortError")); };
    const wake = (id: string) => {
      if (id !== documentId || !isGeometryPreviewIdle(documentId)) return;
      cleanup(); resolve(guard(documentId, signal));
    };
    listeners.add(wake);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else wake(documentId);
  });
}

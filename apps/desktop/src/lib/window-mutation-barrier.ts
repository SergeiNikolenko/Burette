export class ExitTransitionActiveError extends Error {
  constructor() {
    super("A quit or restart transition is already in progress.");
    this.name = "ExitTransitionActiveError";
  }
}

export type WindowCloseMutationPermit = {
  release: () => void;
  waitForPending: (documentIds?: Iterable<string>) => Promise<void>;
};

export function createExitMutationBarrier() {
  let exitSealed = false;
  let closeTransitionActive = false;
  let nextLeaseId = 0;
  const leases = new Map<number, string>();
  const pendingWaiters = new Set<{
    documentIds: Set<string> | null;
    resolve: () => void;
  }>();

  const hasPendingLease = (documentIds: Set<string> | null) => {
    if (documentIds === null) return leases.size > 0;
    for (const documentId of leases.values()) {
      if (documentIds.has(documentId)) return true;
    }
    return false;
  };

  const resolveSettledWaiters = () => {
    for (const waiter of pendingWaiters) {
      if (hasPendingLease(waiter.documentIds)) continue;
      pendingWaiters.delete(waiter);
      waiter.resolve();
    }
  };

  const snapshot = () => ({
    closeTransitionActive,
    pendingCount: leases.size,
    pendingDocumentIds: [...new Set(leases.values())],
  });

  return {
    begin(documentId: string) {
      if (exitSealed || closeTransitionActive) throw new ExitTransitionActiveError();
      const leaseId = nextLeaseId;
      nextLeaseId += 1;
      leases.set(leaseId, documentId);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        leases.delete(leaseId);
        resolveSettledWaiters();
      };
    },
    beginCloseTransition(): WindowCloseMutationPermit & ReturnType<typeof snapshot> {
      if (exitSealed || closeTransitionActive) throw new ExitTransitionActiveError();
      closeTransitionActive = true;
      let released = false;
      return {
        ...snapshot(),
        release() {
          if (released) return;
          released = true;
          closeTransitionActive = false;
        },
        waitForPending(documentIds?: Iterable<string>) {
          const targetIds = documentIds === undefined ? null : new Set(documentIds);
          if (!hasPendingLease(targetIds)) return Promise.resolve();
          return new Promise<void>((resolve) => {
            pendingWaiters.add({ documentIds: targetIds, resolve });
          });
        },
      };
    },
    resume() {
      exitSealed = false;
    },
    seal() {
      exitSealed = true;
      return snapshot();
    },
  };
}

const windowExitMutationBarrier = createExitMutationBarrier();
const windowMutationTails = new Map<string, Promise<void>>();
const gridDocumentCloseTransitionCounts = new Map<string, number>();
const pendingGridCloseTransitionRequests = new WeakMap<
  HTMLIFrameElement,
  Set<{ post: () => void }>
>();
let nextGridTransitionRequestId = 0;

function trackPendingGridCloseTransitionRequest(
  iframe: HTMLIFrameElement,
  request: { post: () => void },
) {
  const requests = pendingGridCloseTransitionRequests.get(iframe) ?? new Set();
  requests.add(request);
  pendingGridCloseTransitionRequests.set(iframe, requests);
  return () => {
    requests.delete(request);
    if (requests.size === 0) pendingGridCloseTransitionRequests.delete(iframe);
  };
}

export function replayPendingGridCloseTransitionRequests(iframe: HTMLIFrameElement) {
  for (const request of pendingGridCloseTransitionRequests.get(iframe) ?? []) {
    request.post();
  }
}

export async function runWindowMutation<T>(documentId: string, operation: () => Promise<T>) {
  const release = windowExitMutationBarrier.begin(documentId);
  const previous = windowMutationTails.get(documentId) ?? Promise.resolve();
  let releaseTurn = () => {};
  const current = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  windowMutationTails.set(documentId, current);
  try {
    await previous;
    return await operation();
  } finally {
    releaseTurn();
    if (windowMutationTails.get(documentId) === current) {
      windowMutationTails.delete(documentId);
    }
    release();
  }
}

export function beginWindowCloseTransition() {
  return windowExitMutationBarrier.beginCloseTransition();
}

export function isGridDocumentCloseTransitionActive(documentId: string) {
  return (gridDocumentCloseTransitionCounts.get(documentId) ?? 0) > 0;
}

export function setGridDocumentCloseTransition(documentIds: Iterable<string>, active: boolean) {
  const targetIds = new Set(documentIds);
  for (const documentId of targetIds) {
    const currentCount = gridDocumentCloseTransitionCounts.get(documentId) ?? 0;
    const nextCount = active ? currentCount + 1 : Math.max(0, currentCount - 1);
    if (nextCount > 0) gridDocumentCloseTransitionCounts.set(documentId, nextCount);
    else gridDocumentCloseTransitionCounts.delete(documentId);
  }
  if (typeof document === "undefined") return;
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")) {
    const documentId = iframe.dataset.documentId;
    if (!documentId || !targetIds.has(documentId)) continue;
    const transitionActive = isGridDocumentCloseTransitionActive(documentId);
    if (transitionActive) iframe.blur();
    iframe.inert = transitionActive;
    iframe.toggleAttribute("aria-busy", transitionActive);
    iframe.contentWindow?.postMessage({
      source: "burrete-grid-host",
      body: { type: "gridCloseTransitionChanged", active: transitionActive },
    }, "*");
  }
}

export async function waitForGridDocumentCloseTransition(documentIds: Iterable<string>) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const targetIds = new Set(documentIds);
  const acknowledgements: Promise<void>[] = [];
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")) {
    const documentId = iframe.dataset.documentId;
    const contentWindow = iframe.contentWindow;
    if (iframe.dataset.renderer !== "grid2d"
      || !documentId
      || !targetIds.has(documentId)
      || !contentWindow) continue;
    if (!isGridDocumentCloseTransitionActive(documentId)) {
      throw new Error("Grid document transition is not active.");
    }
    nextGridTransitionRequestId += 1;
    const requestId = `grid-close-transition-${nextGridTransitionRequestId}`;
    acknowledgements.push(new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutId: number | undefined;
      let retryTimeoutId: number | undefined;
      const request = {
        post: () => {
          if (settled) return;
          contentWindow.postMessage({
            source: "burrete-grid-host",
            body: { type: "gridCloseTransitionChanged", active: true, requestId },
          }, "*");
        },
      };
      const stopTracking = trackPendingGridCloseTransitionRequest(iframe, request);
      const cleanup = () => {
        settled = true;
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        if (retryTimeoutId !== undefined) window.clearTimeout(retryTimeoutId);
        window.removeEventListener("message", handleAcknowledgement);
        stopTracking();
      };
      const handleAcknowledgement = (event: MessageEvent) => {
        if (event.source !== contentWindow) return;
        const data = event.data as { source?: unknown; body?: { type?: unknown; requestId?: unknown; active?: unknown } } | null;
        if (data?.source !== "burrete-grid"
          || data.body?.type !== "gridCloseTransitionAcknowledged"
          || data.body.requestId !== requestId) return;
        cleanup();
        if (data.body.active !== true) {
          reject(new Error("Grid rejected the document transition."));
          return;
        }
        resolve();
      };
      window.addEventListener("message", handleAcknowledgement);
      timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error("Grid did not acknowledge the document transition."));
      }, 2_000);
      const retry = () => {
        retryTimeoutId = window.setTimeout(() => {
          request.post();
          if (!settled) retry();
        }, 50);
      };
      request.post();
      if (!settled) retry();
    }));
  }
  await Promise.all(acknowledgements);
}

export function sameWindowItemIds(before: Iterable<string>, after: Iterable<string>) {
  const beforeIds = [...before];
  const afterIds = [...after];
  return beforeIds.length === afterIds.length
    && beforeIds.every((itemId, index) => itemId === afterIds[index]);
}

export function setWindowShellCloseTransition(active: boolean) {
  if (typeof document === "undefined") return;
  const shell = document.querySelector<HTMLElement>(".app-shell");
  if (!shell) return;
  shell.inert = active;
  shell.toggleAttribute("aria-busy", active);
}

export function resumeWindowMutations() {
  windowExitMutationBarrier.resume();
}

export function sealWindowMutations() {
  return windowExitMutationBarrier.seal();
}

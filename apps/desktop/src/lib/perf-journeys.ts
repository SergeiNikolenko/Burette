import { useMoleculeStore } from "../stores/molecule-store";
import { perfEventTime, perfNow, tracePerf } from "./perf-trace";

// Journey tracing for performance work, loaded only when the perf trace is on
// (see perf-trace.ts). It watches the shell from the outside — store
// transitions, viewer frame loads, viewer messages, frame intervals — so the
// code it measures runs unchanged.
//
// Lines it writes:
// - `frames`: rAF intervals of the last second plus React commits, shell DOM
//   mutations and viewer messages by type in it. Viewer frames share the
//   WebContent main thread with the shell, so a long frame here is a long
//   frame for the viewer too.
// - `document:added`, `tab:switch`, `document:visible`, `document:ready`: a
//   newly active document from the store change to the first frame in which
//   its iframe is visible, then to the viewer's `ready` message. `blankFrames`
//   counts frames in which no viewer frame was visible.
// - `iframe:mount`, `iframe:load`, `iframe:unmount`: viewer frame lifecycle;
//   a warm tab switch should produce none of them.
// - `viewer:status`, `viewer:ready`, `viewer:error`: viewer progress messages,
//   including one "Parsing structure" status per parse.
// - `input:*` and `mark:*`: shell input and the app's performance marks.

declare global {
  interface Window {
    __BURETTE_REACT_COMMITS__?: { commits: number };
  }
}

type ViewerMessage = { source?: unknown; body?: { type?: unknown; message?: unknown; documentId?: unknown } | null };

type Journey = {
  kind: "open" | "tab";
  documentId: string;
  from: string | null;
  startedAt: number;
  inputAt: number | null;
  frame: HTMLIFrameElement | null;
  commitsAt: number;
  frames: number;
  blankFrames: number;
  loads: number;
  visibleAt: number | null;
};

const VIEWER_SOURCES = new Set(["burette-viewer", "burette-grid"]);
const TRACED_VIEWER_MESSAGES = new Set(["ready", "status", "error"]);
const JOURNEY_TIMEOUT_MS = 20_000;
const INPUT_WINDOW_MS = 1_000;
const RECENTLY_ADDED_MS = 5_000;

const journeys = new Map<string, Journey>();
const addedAt = new Map<string, number>();
let lastInputAt: number | null = null;
let mutations = 0;
let viewerMessages: Record<string, number> = {};

function reactCommits() {
  return window.__BURETTE_REACT_COMMITS__?.commits ?? 0;
}

function viewerFrames(documentId?: string) {
  const selector = documentId ? `iframe[data-document-id="${CSS.escape(documentId)}"]` : "iframe[data-document-id]";
  return Array.from(document.querySelectorAll<HTMLIFrameElement>(selector))
    .filter(frame => frame.dataset.sourcePreviewRole !== "staging");
}

function frameVisible(frame: HTMLIFrameElement) {
  if (!frame.isConnected) return false;
  const rect = frame.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0
    && frame.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

function frameDetail(frame: HTMLIFrameElement) {
  return {
    documentId: frame.dataset.documentId ?? null,
    renderer: frame.dataset.renderer ?? null,
    role: frame.dataset.sourcePreviewRole ?? null,
  };
}

function startJourney(kind: Journey["kind"], documentId: string, from: string | null) {
  const startedAt = perfNow();
  const inputAt = lastInputAt !== null && startedAt - lastInputAt <= INPUT_WINDOW_MS ? lastInputAt : null;
  journeys.set(documentId, {
    kind, documentId, from, startedAt, inputAt,
    frame: viewerFrames(documentId)[0] ?? null,
    commitsAt: reactCommits(),
    frames: 0, blankFrames: 0, loads: 0, visibleAt: null,
  });
  if (kind === "tab") tracePerf("tab:switch", { at: startedAt, detail: { documentId, from, inputAt } });
}

function finishJourney(journey: Journey, name: string, extra: Record<string, unknown> = {}) {
  const now = perfNow();
  tracePerf(name, {
    at: journey.startedAt,
    ms: now - journey.startedAt,
    detail: {
      kind: journey.kind,
      documentId: journey.documentId,
      from: journey.from,
      inputMs: journey.inputAt === null ? null : now - journey.inputAt,
      frames: journey.frames,
      blankFrames: journey.blankFrames,
      loads: journey.loads,
      commits: reactCommits() - journey.commitsAt,
      ...extra,
    },
  });
}

function checkJourneys() {
  const now = perfNow();
  const anyVisible = viewerFrames().some(frameVisible);
  for (const journey of journeys.values()) {
    journey.frames++;
    if (!anyVisible) journey.blankFrames++;
    if (journey.visibleAt === null) {
      const frame = viewerFrames(journey.documentId).find(frameVisible);
      if (frame) {
        journey.visibleAt = now;
        finishJourney(journey, "document:visible", { remounted: journey.frame !== frame });
        // A warm frame that kept its document needs no ready message.
        if (journey.kind === "tab" && journey.frame === frame && journey.loads === 0) journeys.delete(journey.documentId);
      }
    }
    if (now - journey.startedAt > JOURNEY_TIMEOUT_MS) {
      finishJourney(journey, "journey:timeout");
      journeys.delete(journey.documentId);
    }
  }
}

function watchFrames() {
  let intervals: number[] = [];
  let bucketAt = perfNow();
  let commitsAt = reactCommits();
  let previous: number | null = null;
  const flush = () => {
    if (intervals.length > 0) {
      tracePerf("frames", {
        at: bucketAt,
        ms: perfNow() - bucketAt,
        detail: { intervals, commits: reactCommits() - commitsAt, mutations, viewerMessages },
      });
    }
    intervals = [];
    mutations = 0;
    viewerMessages = {};
    bucketAt = perfNow();
    commitsAt = reactCommits();
  };
  const tick = (time: number) => {
    if (previous !== null) intervals.push(Math.round((time - previous) * 10) / 10);
    previous = time;
    checkJourneys();
    if (perfNow() - bucketAt >= 1_000) flush();
    window.requestAnimationFrame(tick);
  };
  document.addEventListener("visibilitychange", () => {
    flush();
    previous = null;
  });
  window.requestAnimationFrame(tick);
}

function watchStore() {
  let { documents, activeDocumentId } = useMoleculeStore.getState();
  useMoleculeStore.subscribe((state) => {
    if (state.documents !== documents) {
      const known = new Set(documents.map(document => document.id));
      for (const document of state.documents) {
        if (known.has(document.id)) continue;
        addedAt.set(document.id, perfNow());
        tracePerf("document:added", {
          detail: {
            documentId: document.id,
            path: document.path.slice(-512),
            renderer: document.renderer,
            extension: document.extension,
            byteCount: document.byteCount,
          },
        });
      }
      documents = state.documents;
    }
    if (state.activeDocumentId !== activeDocumentId) {
      const from = activeDocumentId;
      activeDocumentId = state.activeDocumentId;
      if (!activeDocumentId) return;
      const added = addedAt.get(activeDocumentId);
      startJourney(added !== undefined && perfNow() - added <= RECENTLY_ADDED_MS ? "open" : "tab", activeDocumentId, from);
    }
  });
}

function watchViewerMessages() {
  window.addEventListener("message", (event) => {
    const data = event.data as ViewerMessage | null;
    if (!data || typeof data.source !== "string" || !VIEWER_SOURCES.has(data.source)) return;
    const type = typeof data.body?.type === "string" ? data.body.type.slice(0, 48) : "";
    viewerMessages[type] = (viewerMessages[type] ?? 0) + 1;
    if (!TRACED_VIEWER_MESSAGES.has(type)) return;
    const documentId = typeof data.body?.documentId === "string" ? data.body.documentId : null;
    const message = typeof data.body?.message === "string" ? data.body.message.slice(0, 80) : null;
    tracePerf(`viewer:${type}`, { detail: { source: data.source, documentId, message } });
    const journey = documentId ? journeys.get(documentId) : undefined;
    if (journey && type === "ready") {
      finishJourney(journey, "document:ready");
      journeys.delete(journey.documentId);
    }
  });
}

function watchFrameLifecycle() {
  document.addEventListener("load", (event) => {
    const frame = event.target as HTMLIFrameElement | null;
    if (frame?.tagName !== "IFRAME" || !frame.dataset.documentId) return;
    const journey = journeys.get(frame.dataset.documentId);
    if (journey) journey.loads++;
    tracePerf("iframe:load", { detail: frameDetail(frame) });
  }, true);
  const frameNodes = (nodes: NodeList) => Array.from(nodes).flatMap((node) => {
    if (!(node instanceof Element)) return [];
    if (node instanceof HTMLIFrameElement) return node.dataset.documentId ? [node] : [];
    return Array.from(node.querySelectorAll<HTMLIFrameElement>("iframe[data-document-id]"));
  });
  new MutationObserver((records) => {
    mutations += records.length;
    for (const record of records) {
      for (const frame of frameNodes(record.addedNodes)) tracePerf("iframe:mount", { detail: frameDetail(frame) });
      for (const frame of frameNodes(record.removedNodes)) tracePerf("iframe:unmount", { detail: frameDetail(frame) });
    }
  }).observe(document.body, { childList: true, subtree: true });
}

function inputTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  const control = element?.closest("[role=separator],[data-separator],[data-panel-resize-handle-id],button,[role=tab],[role=treeitem]");
  if (!control) return element?.tagName.toLowerCase() ?? null;
  const label = control.getAttribute("aria-label") || control.getAttribute("title") || control.textContent?.trim().slice(0, 40) || "";
  return `${control.getAttribute("role") || control.tagName.toLowerCase()}${label ? `:${label}` : ""}`;
}

function watchInput() {
  const record = (event: Event) => {
    lastInputAt = perfEventTime(event);
    tracePerf(`input:${event.type}`, { at: lastInputAt, detail: { target: inputTarget(event.target) } });
  };
  for (const type of ["pointerdown", "pointerup", "keydown"]) {
    document.addEventListener(type, record, { capture: true, passive: true });
  }
}

function forwardPerformanceMarks() {
  const forward = (entries: PerformanceEntryList) => {
    for (const entry of entries) tracePerf(`mark:${entry.name}`, { at: performance.timeOrigin + entry.startTime });
  };
  forward(performance.getEntriesByType("mark"));
  new PerformanceObserver(list => forward(list.getEntries())).observe({ type: "mark" });
}

export function installPerfJourneys() {
  forwardPerformanceMarks();
  watchInput();
  watchStore();
  watchViewerMessages();
  watchFrameLifecycle();
  watchFrames();
}

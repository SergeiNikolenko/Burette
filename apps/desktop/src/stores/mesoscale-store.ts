import { create } from "zustand";
import {
  MESOSCALE_API_VERSION,
  isMesoscaleCanvasInteractionMessage,
  isMesoscaleResponse,
  boundMesoscaleHierarchyPage,
  mergeMesoscaleHierarchySelection,
  mesoscaleSelectedCount,
  type MesoscaleAction,
  type MesoscaleChromeMessage,
  type MesoscaleControlPlacement,
  type MesoscaleFailure,
  type MesoscaleHierarchyPage,
  type MesoscaleHierarchySelector,
  type MesoscalePreviewMessage,
  type MesoscaleRequest,
  type MesoscaleResult,
  type MesoscaleSceneSummary,
  type MesoscaleSessionState,
} from "../lib/mesoscale-contract";

type MesoscaleStore = {
  sessions: Record<string, MesoscaleSessionState>;
  setSession: (documentId: string, update: (session: MesoscaleSessionState) => MesoscaleSessionState) => void;
  removeSession: (documentId: string) => void;
};

const frames = new Map<string, Window>();
const frameGenerations = new Map<string, number>();
const previewFrames = new Map<string, number>();
const previewSequences = new Map<string, number>();
const pendingPreviewRefs = new Map<string, string | null>();
const pendingPreviewSelectors = new Map<string, MesoscaleHierarchySelector | undefined>();
const selectionRefreshes = new Map<string, { revision: number; running: boolean }>();
const pending = new Map<string, {
  documentId: string;
  resolve: (result: MesoscaleResult) => void;
  reject: (error: Error) => void;
  timer: number;
}>();
let installed = false;

function emptySession(documentId: string): MesoscaleSessionState {
  return {
    status: "loading",
    documentId,
    revision: 0,
    summary: null,
    hierarchy: [],
    hierarchyFilter: "",
    hierarchyNextCursor: 0,
    hierarchyTotal: 0,
    hoveredRef: null,
    canvasContextMenu: null,
    sceneOpen: false,
    layoutPreference: { left: false, right: false },
    pendingCount: 0,
    error: null,
  };
}

export const useMesoscaleStore = create<MesoscaleStore>((set) => ({
  sessions: {},
  setSession: (documentId, update) => set((state) => ({
    sessions: {
      ...state.sessions,
      [documentId]: update(state.sessions[documentId] ?? emptySession(documentId)),
    },
  })),
  removeSession: (documentId) => set((state) => {
    if (!state.sessions[documentId]) return state;
    const sessions = { ...state.sessions };
    delete sessions[documentId];
    return { sessions };
  }),
}));

function updateSession(documentId: string, update: (session: MesoscaleSessionState) => MesoscaleSessionState) {
  useMesoscaleStore.getState().setSession(documentId, update);
}

function applySummary(documentId: string, summary: MesoscaleSceneSummary) {
  const normalizedSummary = { ...summary, selectedCount: mesoscaleSelectedCount(summary) };
  updateSession(documentId, (session) => {
    if (normalizedSummary.revision < session.revision) return session;
    const stableSummary = normalizedSummary.hierarchyTotal === 0 && session.hierarchyTotal > 0
      ? {
          ...normalizedSummary,
          counts: session.summary?.counts ?? normalizedSummary.counts,
          hierarchyPreview: session.hierarchy,
          hierarchyTotal: session.hierarchyTotal,
        }
      : normalizedSummary;
    const hierarchy = mergeMesoscaleHierarchySelection(
      session.hierarchy.length > 0 ? session.hierarchy : stableSummary.hierarchyPreview,
      stableSummary,
    );
    return {
      ...session,
      status: session.pendingCount > 0 ? "busy" : "ready",
      revision: normalizedSummary.revision,
      summary: stableSummary,
      hierarchy,
      hierarchyNextCursor: session.hierarchy.length > 0
        ? session.hierarchyNextCursor
        : stableSummary.hierarchyPreview.length < stableSummary.hierarchyTotal ? stableSummary.hierarchyPreview.length : null,
      hierarchyTotal: session.hierarchy.length > 0 ? session.hierarchyTotal : stableSummary.hierarchyTotal,
      error: null,
    };
  });
  const session = useMesoscaleStore.getState().sessions[documentId];
  if (normalizedSummary.selectionTruncated && session?.hierarchy.length > 0) {
    scheduleMesoscaleSelectionRefresh(documentId, normalizedSummary.revision);
  }
}

function scheduleMesoscaleSelectionRefresh(documentId: string, revision: number) {
  let refresh = selectionRefreshes.get(documentId);
  if (refresh) {
    refresh.revision = Math.max(refresh.revision, revision);
    if (refresh.running) return;
  } else {
    refresh = { revision, running: false };
    selectionRefreshes.set(documentId, refresh);
  }
  refresh.running = true;
  queueMicrotask(() => {
    void (async () => {
      while (selectionRefreshes.get(documentId) === refresh) {
        const targetRevision = refresh.revision;
        const session = useMesoscaleStore.getState().sessions[documentId];
        const targetCount = session?.hierarchy.length ?? 0;
        const filter = session?.hierarchyFilter ?? "";
        let cursor = 0;
        while (cursor < targetCount) {
          const result = await requestMesoscale(documentId, { type: "getHierarchyPage", filter, cursor });
          if (refresh.revision !== targetRevision || result.kind !== "hierarchy-page" || result.nextCursor === null) break;
          cursor = result.nextCursor;
        }
        if (refresh.revision === targetRevision) break;
      }
    })().catch(() => undefined).finally(() => {
      if (selectionRefreshes.get(documentId) === refresh) selectionRefreshes.delete(documentId);
    });
  });
}

function applyHierarchyPage(documentId: string, page: MesoscaleHierarchyPage) {
  page = boundMesoscaleHierarchyPage(page);
  updateSession(documentId, (session) => {
    if (page.revision < session.revision) return session;
    const knownObjectCount = Math.max(
      session.hierarchyTotal,
      (session.summary?.counts.groups ?? 0) + (session.summary?.counts.entities ?? 0),
    );
    if (page.cursor === 0 && page.total === 0 && !page.filter && knownObjectCount > 0) {
      return {
        ...session,
        status: session.pendingCount > 0 ? "busy" : "ready",
        revision: page.revision,
      };
    }
    const hierarchy = page.cursor === 0
      ? page.items
      : [...session.hierarchy, ...page.items.filter((item) => !session.hierarchy.some((current) => current.ref === item.ref))];
    return {
      ...session,
      status: session.pendingCount > 0 ? "busy" : "ready",
      revision: page.revision,
      hierarchy,
      hierarchyFilter: page.filter,
      hierarchyNextCursor: page.nextCursor,
      hierarchyTotal: page.total,
      error: null,
    };
  });
}

function applyFailure(documentId: string, failure: MesoscaleFailure) {
  updateSession(documentId, (session) => ({
    ...session,
    status: "error",
    revision: failure.revision,
    error: failure,
  }));
}

function handleResult(documentId: string, result: MesoscaleResult) {
  if (result.kind === "summary") applySummary(documentId, result);
  else if (result.kind === "hierarchy-page") applyHierarchyPage(documentId, result);
  else if (result.kind === "failure") applyFailure(documentId, result);
}

function installBridge() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("message", (event) => {
    if (isMesoscaleCanvasInteractionMessage(event.data)) {
      const interaction = event.data;
      if (frames.get(interaction.documentId) !== event.source) return;
      if (interaction.kind === "layout-resize") {
        const frame = Array.from(window.document.querySelectorAll("iframe"))
          .find((candidate) => candidate.contentWindow === event.source);
        const stage = frame?.closest<HTMLElement>(".molecule-stage");
        const available = Math.max(0, (stage?.getBoundingClientRect().width ?? 0) - 240);
        const left = Math.min(available, Math.max(0, interaction.reservation.left));
        const right = Math.min(Math.max(0, available - left), Math.max(0, interaction.reservation.right));
        stage?.style.setProperty("--mesoscale-canvas-left", `${left}px`);
        stage?.style.setProperty("--mesoscale-canvas-right", `${right}px`);
        return;
      }
      applySummary(interaction.documentId, interaction.summary);
      if (interaction.kind === "context-menu") {
        const frame = Array.from(window.document.querySelectorAll("iframe"))
          .find((candidate) => candidate.contentWindow === event.source);
        const rect = frame?.getBoundingClientRect();
        updateSession(interaction.documentId, (session) => ({
          ...session,
          canvasContextMenu: {
            ...interaction.menu,
            x: interaction.menu.x + (rect?.left ?? 0),
            y: interaction.menu.y + (rect?.top ?? 0),
            token: window.performance.now(),
          },
        }));
      }
      return;
    }
    if (!isMesoscaleResponse(event.data)) return;
    const response = event.data;
    if (frames.get(response.documentId) !== event.source) return;
    handleResult(response.documentId, response.result);
    if (!response.requestId && response.result.kind === "summary") {
      const layout = useMesoscaleStore.getState().sessions[response.documentId]?.layoutPreference;
      if (layout) void restoreMesoscaleLayout(response.documentId, event.source as Window, layout);
    }
    if (!response.requestId) return;
    const request = pending.get(response.requestId);
    if (!request || request.documentId !== response.documentId) return;
    pending.delete(response.requestId);
    window.clearTimeout(request.timer);
    updateSession(response.documentId, (session) => {
      const pendingCount = Math.max(0, session.pendingCount - 1);
      return { ...session, pendingCount, status: session.error ? "error" : pendingCount > 0 ? "busy" : "ready" };
    });
    if (response.result.kind === "failure") request.reject(new Error(response.result.message));
    else request.resolve(response.result);
  });
}

export function bindMesoscaleFrame(documentId: string, frame: Window) {
  installBridge();
  frames.set(documentId, frame);
  frameGenerations.set(documentId, (frameGenerations.get(documentId) ?? 0) + 1);
  previewMesoscaleObject(documentId, null);
  updateSession(documentId, (session) => session.status === "disposed"
    ? { ...emptySession(documentId), sceneOpen: session.sceneOpen, layoutPreference: session.layoutPreference }
    : session);
  void requestMesoscale(documentId, { type: "getSummary" }).catch(() => undefined);
}

async function restoreMesoscaleLayout(documentId: string, frame: Window, layout: { left: boolean; right: boolean }) {
  try {
    if (layout.left) await requestMesoscale(documentId, { type: "setLayoutRegion", region: "left", visible: true });
    if (frames.get(documentId) !== frame) return;
    if (layout.right) await requestMesoscale(documentId, { type: "setLayoutRegion", region: "right", visible: true });
  } catch {
    // The load/error surface owns runtime failures; restoring UI chrome is best-effort.
  }
}

export function releaseMesoscaleFrame(documentId: string, frame?: Window | null) {
  if (frame && frames.get(documentId) !== frame) return;
  const activeFrame = frames.get(documentId);
  if (activeFrame) postMesoscalePreview(activeFrame, documentId, null);
  const previewFrame = previewFrames.get(documentId);
  if (previewFrame !== undefined) window.cancelAnimationFrame(previewFrame);
  previewFrames.delete(documentId);
  previewSequences.delete(documentId);
  pendingPreviewRefs.delete(documentId);
  pendingPreviewSelectors.delete(documentId);
  selectionRefreshes.delete(documentId);
  frames.delete(documentId);
  frameGenerations.set(documentId, (frameGenerations.get(documentId) ?? 0) + 1);
  for (const [requestId, request] of pending) {
    if (request.documentId !== documentId) continue;
    pending.delete(requestId);
    window.clearTimeout(request.timer);
    request.reject(new Error("Mesoscale runtime was disposed"));
  }
  updateSession(documentId, (session) => ({ ...session, status: "disposed", pendingCount: 0, hoveredRef: null, canvasContextMenu: null }));
}

export function mesoscaleFrameGeneration(documentId: string) {
  return frameGenerations.get(documentId) ?? 0;
}

export function removeMesoscaleSession(documentId: string) {
  releaseMesoscaleFrame(documentId);
  useMesoscaleStore.getState().removeSession(documentId);
}

export function requestMesoscale(documentId: string, action: MesoscaleAction, timeoutMs = 15_000) {
  installBridge();
  const frame = frames.get(documentId);
  if (!frame) return Promise.reject(new Error("Mesoscale viewport is not ready"));
  const requestId = `mesoscale-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const session = useMesoscaleStore.getState().sessions[documentId];
  const request: MesoscaleRequest = {
    source: "burette-mesoscale-host",
    apiVersion: MESOSCALE_API_VERSION,
    documentId,
    requestId,
    ...(session?.summary && action.type !== "getSummary" && action.type !== "getHierarchyPage"
      ? { expectedRevision: session.revision }
      : {}),
    action,
  };
  updateSession(documentId, (current) => ({
    ...current,
    ...(action.type === "setLayoutRegion"
      ? { layoutPreference: { ...current.layoutPreference, [action.region]: action.visible } }
      : {}),
    status: "busy",
    pendingCount: current.pendingCount + 1,
    error: null,
  }));
  return new Promise<MesoscaleResult>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      updateSession(documentId, (current) => {
        const pendingCount = Math.max(0, current.pendingCount - 1);
        return { ...current, pendingCount, status: pendingCount > 0 ? "busy" : current.summary ? "ready" : "error" };
      });
      reject(new Error(`Mesoscale ${action.type} timed out`));
    }, timeoutMs);
    pending.set(requestId, { documentId, resolve, reject, timer });
    frame.postMessage(request, "*");
  });
}

export function loadMesoscaleHierarchy(documentId: string, filter: string, cursor = 0) {
  return requestMesoscale(documentId, { type: "getHierarchyPage", filter, cursor });
}

function postMesoscalePreview(frame: Window, documentId: string, ref: string | null, selector?: MesoscaleHierarchySelector) {
  const sequence = (previewSequences.get(documentId) ?? 0) + 1;
  previewSequences.set(documentId, sequence);
  const message: MesoscalePreviewMessage = {
    source: "burette-mesoscale-preview",
    apiVersion: MESOSCALE_API_VERSION,
    documentId,
    sequence,
    ref,
    selector,
  };
  frame.postMessage(message, "*");
}

export function previewMesoscaleObject(documentId: string, ref: string | null, selector?: MesoscaleHierarchySelector) {
  updateSession(documentId, (session) => session.hoveredRef === ref ? session : { ...session, hoveredRef: ref });
  pendingPreviewRefs.set(documentId, ref);
  pendingPreviewSelectors.set(documentId, ref ? selector : undefined);
  if (previewFrames.has(documentId)) return;
  previewFrames.set(documentId, window.requestAnimationFrame(() => {
    previewFrames.delete(documentId);
    const frame = frames.get(documentId);
    if (!frame) return;
    postMesoscalePreview(frame, documentId, pendingPreviewRefs.get(documentId) ?? null, pendingPreviewSelectors.get(documentId));
  }));
}

export function positionMesoscaleControls(documentId: string, placement: MesoscaleControlPlacement) {
  const frame = frames.get(documentId);
  if (!frame) return;
  const message: MesoscaleChromeMessage = {
    source: "burette-mesoscale-chrome",
    apiVersion: MESOSCALE_API_VERSION,
    documentId,
    placement,
  };
  frame.postMessage(message, "*");
}

export function setMesoscaleSceneOpen(documentId: string, open: boolean) {
  updateSession(documentId, (session) => session.sceneOpen === open ? session : { ...session, sceneOpen: open });
}

export function consumeMesoscaleCanvasContextMenu(documentId: string, token: number) {
  updateSession(documentId, (session) => session.canvasContextMenu?.token === token
    ? { ...session, canvasContextMenu: null }
    : session);
}

export function setMesoscaleVisibilityOptimistic(documentId: string, ref: string, hidden: boolean) {
  updateSession(documentId, (session) => ({
    ...session,
    hierarchy: session.hierarchy.map((item) => item.ref === ref ? { ...item, hidden } : item),
  }));
}

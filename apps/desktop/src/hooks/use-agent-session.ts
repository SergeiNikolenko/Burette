import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ViewerDocument } from "../types";
import type { OpenTextFilesResult } from "../types";
import { isTauriRuntime, trackTauriListener } from "../lib/tauri";
import type { DockArea } from "../lib/dock";

const AGENT_API_VERSION = "burette-agent-control/v1";
const ACTION_POLL_INTERVAL_MS = 500;
const BROWSER_AGENT_SESSION_DIR = "__browser_agent_shell__";
const isBrowserAgentShell = import.meta.env.VITE_BURRETE_AGENT_SHELL === "1";

type OpenPaths = (paths: string[]) => void | Promise<void>;
type OpenTextDocuments = (
  paths: string[],
  options?: { inActiveTab?: boolean; background?: boolean },
) => Promise<OpenTextFilesResult | null>;

type AgentActionItem = {
  id: string;
  action: Record<string, unknown>;
  status: "queued" | "dispatched" | "completed" | "failed";
  createdAt?: string;
  dispatchedAt?: string;
  completedAt?: string;
  result?: unknown;
};

type AgentActionsFile = {
  apiVersion?: string;
  actions?: AgentActionItem[];
};

type ReadTextFileResult = {
  content: string;
};

type AgentWorkspacePanel = {
  id: string;
  area: DockArea;
  kind: string;
  title: string;
  path: string | null;
  documentId: string;
};

type ViewerAgentState = {
  documentId: string;
  agentReady: boolean;
  viewerReady: boolean;
  lastMessage: string | null;
  lastError: string | null;
  lastAction: AgentSceneAction | null;
  selection: AgentSceneSelection | null;
  updatedAt: string;
};

type AgentSceneAction = {
  ok: boolean | null;
  command: string | null;
  errorCode: string | null;
  completedAt: string;
};

type AgentSceneSelection = {
  selectionId: string | null;
  selector: unknown;
  ligand: unknown;
  counts: unknown;
};

type UseAgentSessionArgs = {
  activeDocument: ViewerDocument | null | undefined;
  documents: ViewerDocument[];
  openTextDocuments: OpenTextDocuments;
  openPaths: OpenPaths;
  pushErrorStatus: (error: unknown, prefix?: string) => void;
  setDockDocument: (area: DockArea, documentId: string | null) => void;
};

export function useAgentSession({
  activeDocument,
  documents,
  openTextDocuments,
  openPaths,
  pushErrorStatus,
  setDockDocument,
}: UseAgentSessionArgs) {
  const sessionDirRef = useRef<string | null>(null);
  const activeDocumentRef = useRef<ViewerDocument | null | undefined>(activeDocument);
  const documentsRef = useRef<ViewerDocument[]>(documents);
  const openPathsRef = useRef(openPaths);
  const openTextDocumentsRef = useRef(openTextDocuments);
  const pushErrorStatusRef = useRef(pushErrorStatus);
  const setDockDocumentRef = useRef(setDockDocument);
  const pendingViewerActionsRef = useRef(new Map<string, (result: unknown) => void>());
  const workspacePanelsRef = useRef<AgentWorkspacePanel[]>([]);
  const viewerAgentStatesRef = useRef<Record<string, ViewerAgentState>>({});

  useEffect(() => {
    activeDocumentRef.current = activeDocument;
    documentsRef.current = documents;
    void writeObserve(sessionDirRef.current, activeDocument, documents, workspacePanelsRef.current, viewerAgentStatesRef.current);
  }, [activeDocument, documents]);

  useEffect(() => {
    openPathsRef.current = openPaths;
    openTextDocumentsRef.current = openTextDocuments;
    pushErrorStatusRef.current = pushErrorStatus;
    setDockDocumentRef.current = setDockDocument;
  }, [openPaths, openTextDocuments, pushErrorStatus, setDockDocument]);

  const activateSession = useCallback((sessionDir: string | null | undefined) => {
    const cleanSessionDir = typeof sessionDir === "string" ? sessionDir.trim() : "";
    if (!cleanSessionDir) return;
    sessionDirRef.current = cleanSessionDir;
    void writeObserve(cleanSessionDir, activeDocumentRef.current, documentsRef.current, workspacePanelsRef.current, viewerAgentStatesRef.current);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let cancelled = false;
    void invoke<string | null>("startup_agent_session")
      .then((sessionDir) => {
        if (!cancelled) activateSession(sessionDir);
      })
      .catch((error) => pushErrorStatusRef.current(error, "Agent session startup failed"));

    const cleanup = trackTauriListener(listen<string>("agent-session", (event) => {
      activateSession(event.payload);
    }), "agent-session");

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [activateSession]);

  useEffect(() => {
    if (!isBrowserAgentShell) return undefined;
    activateSession(BROWSER_AGENT_SESSION_DIR);
    return undefined;
  }, [activateSession]);

  useEffect(() => {
    if (!isTauriRuntime() && !isBrowserAgentShell) return undefined;
    const handler = (event: MessageEvent) => {
      if (event.data?.source === "burrete-agent-viewer") {
        const body = event.data.body;
        if (!body || body.type !== "agent-action-result" || typeof body.id !== "string") return;
        const activeDocumentId = activeDocumentRef.current?.id;
        if (activeDocumentId) {
          viewerAgentStatesRef.current[activeDocumentId] = viewerAgentStateWithActionResult(
            activeDocumentId,
            viewerAgentStatesRef.current[activeDocumentId],
            body.result,
          );
          void writeObserve(
            sessionDirRef.current,
            activeDocumentRef.current,
            documentsRef.current,
            workspacePanelsRef.current,
            viewerAgentStatesRef.current,
          );
        }
        const resolve = pendingViewerActionsRef.current.get(body.id);
        if (!resolve) return;
        pendingViewerActionsRef.current.delete(body.id);
        resolve(body.result);
        return;
      }
      if (event.data?.source !== "burrete-viewer") return;
      const body = event.data.body;
      if (!body || typeof body.documentId !== "string") return;
      const nextState = viewerAgentStateFromMessage(body, viewerAgentStatesRef.current[body.documentId]);
      if (!nextState) return;
      viewerAgentStatesRef.current[body.documentId] = nextState;
      void writeObserve(
        sessionDirRef.current,
        activeDocumentRef.current,
        documentsRef.current,
        workspacePanelsRef.current,
        viewerAgentStatesRef.current,
      );
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime() && !isBrowserAgentShell) return undefined;
    let busy = false;
    const pollNow = () => {
      const sessionDir = sessionDirRef.current;
      if (!sessionDir || busy) return;
      busy = true;
      void pollAgentActions(
        sessionDir,
        openPathsRef.current,
        openTextDocumentsRef.current,
        setDockDocumentRef.current,
        pendingViewerActionsRef.current,
        workspacePanelsRef.current,
        activeDocumentRef.current,
        documentsRef.current,
        viewerAgentStatesRef.current,
      )
        .catch((error) => pushErrorStatusRef.current(error, "Agent action failed"))
        .finally(() => {
          busy = false;
        });
    };
    const timer = window.setInterval(pollNow, ACTION_POLL_INTERVAL_MS);
    const browserActionEvents = isBrowserAgentShell
      ? new EventSource("/__burette/agent-session/events")
      : null;
    browserActionEvents?.addEventListener("actions", pollNow);
    pollNow();
    return () => {
      window.clearInterval(timer);
      browserActionEvents?.close();
    };
  }, []);
}

async function writeObserve(
  sessionDir: string | null,
  activeDocument: ViewerDocument | null | undefined,
  documents: ViewerDocument[],
  workspacePanels: AgentWorkspacePanel[],
  viewerAgentStates: Record<string, ViewerAgentState>,
) {
  if (!sessionDir || (!isTauriRuntime() && !isBrowserAgentSessionDir(sessionDir))) return;
  const activeAgentState = activeDocument ? viewerAgentStates[activeDocument.id] : undefined;
  const activeMolstar = !!activeDocument && activeDocument.renderer === "molstar";
  const activeReady = activeDocument
    ? activeMolstar
      ? !!(activeAgentState?.viewerReady || activeAgentState?.agentReady)
      : true
    : false;
  const observe = {
    apiVersion: AGENT_API_VERSION,
    mode: isBrowserAgentSessionDir(sessionDir) ? "browser-dev-shell" : "desktop-app",
    transport: isBrowserAgentSessionDir(sessionDir) ? "browser-agent-http-session" : "file-session-token",
    reportedAt: new Date().toISOString(),
    activeDocument: activeDocument
      ? {
          title: activeDocument.title,
          path: activeDocument.path,
          renderer: activeDocument.renderer,
          byteCount: activeDocument.byteCount,
          ready: activeReady,
        }
      : {
          ready: false,
          note: "No active document is open in the desktop app.",
        },
    documents: documents.map((document) => ({
      id: document.id,
      title: document.title,
      path: document.path,
      renderer: document.renderer,
      byteCount: document.byteCount,
    })),
    viewerAgent: {
      apiVersion: "burette-agent/v1",
      available: activeMolstar && !!activeAgentState?.agentReady,
      documentId: activeDocument?.id ?? null,
      ready: activeMolstar && !!activeAgentState?.agentReady,
      viewerReady: activeMolstar && !!activeAgentState?.viewerReady,
      lastMessage: activeAgentState?.lastMessage ?? null,
      lastError: activeAgentState?.lastError ?? null,
      updatedAt: activeAgentState?.updatedAt ?? null,
      note: activeMolstar
        ? "Actions are relayed to the active Mol* viewer iframe after the viewer reports BurreteAgent readiness."
        : "Agent actions require an active Mol* viewer document.",
    },
    scene: {
      known: activeMolstar && !!activeAgentState?.agentReady,
      selection: activeAgentState?.selection ?? null,
      lastAction: activeAgentState?.lastAction ?? null,
    },
    panels: ["viewer", ...workspacePanels.map((panel) => panel.id)],
    workspacePanels,
    errors: [],
  };
  await writeJson(joinSessionPath(sessionDir, "observe.json"), observe);
}

async function pollAgentActions(
  sessionDir: string,
  openPaths: OpenPaths,
  openTextDocuments: OpenTextDocuments,
  setDockDocument: (area: DockArea, documentId: string | null) => void,
  pendingViewerActions: Map<string, (result: unknown) => void>,
  workspacePanels: AgentWorkspacePanel[],
  activeDocument: ViewerDocument | null | undefined,
  documents: ViewerDocument[],
  viewerAgentStates: Record<string, ViewerAgentState>,
) {
  const actionsPath = joinSessionPath(sessionDir, "actions.json");
  const actionsFile = await readJson<AgentActionsFile>(actionsPath, { apiVersion: AGENT_API_VERSION, actions: [] });
  const actions = Array.isArray(actionsFile.actions) ? actionsFile.actions : [];
  const nextAction = actions.find((item) => item.status === "queued");
  if (!nextAction) return;
  nextAction.status = "dispatched";
  nextAction.dispatchedAt = new Date().toISOString();
  await writeJson(actionsPath, { apiVersion: AGENT_API_VERSION, actions });
  const result = await executeDesktopAgentAction(
    nextAction,
    openPaths,
    openTextDocuments,
    setDockDocument,
    pendingViewerActions,
    workspacePanels,
    activeDocument,
    viewerAgentStates,
  );
  nextAction.completedAt = new Date().toISOString();
  nextAction.result = result;
  nextAction.status = isFailedResult(result) ? "failed" : "completed";
  await writeJson(actionsPath, { apiVersion: AGENT_API_VERSION, actions });
  await writeObserve(sessionDir, activeDocument, documents, workspacePanels, viewerAgentStates);
}

async function executeDesktopAgentAction(
  item: AgentActionItem,
  openPaths: OpenPaths,
  openTextDocuments: OpenTextDocuments,
  setDockDocument: (area: DockArea, documentId: string | null) => void,
  pendingViewerActions: Map<string, (result: unknown) => void>,
  workspacePanels: AgentWorkspacePanel[],
  activeDocument: ViewerDocument | null | undefined,
  viewerAgentStates: Record<string, ViewerAgentState>,
) {
  const type = String(item.action?.type || "");
  if (type === "open_files") {
    const paths = Array.isArray(item.action.paths) ? item.action.paths.filter((path): path is string => typeof path === "string" && path.trim().length > 0) : [];
    if (paths.length === 0) {
      return agentFailure(type, "INVALID_ARGS", "open_files requires a non-empty paths array.");
    }
    await openPaths(paths);
    return { ok: true, command: "open_files", result: { pathCount: paths.length } };
  }
  if (type === "render_panel") {
    return renderPanel(item.action, openTextDocuments, setDockDocument, workspacePanels);
  }
  return postActionToActiveViewer(item, pendingViewerActions, activeDocument, viewerAgentStates);
}

async function renderPanel(
  action: Record<string, unknown>,
  openTextDocuments: OpenTextDocuments,
  setDockDocument: (area: DockArea, documentId: string | null) => void,
  workspacePanels: AgentWorkspacePanel[],
) {
  const kind = String(action.kind || "").trim();
  if (!["markdown", "table", "chart"].includes(kind)) {
    return agentFailure("render_panel", "INVALID_ARGS", "render_panel kind must be markdown, table, or chart.");
  }
  const file = typeof action.file === "string" ? action.file.trim() : "";
  if (!file) {
    return agentFailure("render_panel", "INVALID_ARGS", "render_panel requires a file path.");
  }
  const result = await openTextDocuments([file], { background: true });
  const document = result?.documents[0] ?? null;
  if (!document) {
    return agentFailure("render_panel", "OPEN_FAILED", "Panel file could not be opened as a text document.");
  }
  const area: DockArea = action.area === "bottom" ? "bottom" : "right";
  setDockDocument(area, document.id);
  const panel = {
    id: `agent-panel:${area}:${kind}:${document.title}`,
    area,
    kind,
    title: document.title,
    path: document.path,
    documentId: document.id,
  };
  const existing = workspacePanels.findIndex((item) => item.area === area);
  if (existing === -1) workspacePanels.push(panel);
  else workspacePanels[existing] = panel;
  return {
    ok: true,
    command: "render_panel",
    result: {
      kind,
      area,
      documentId: document.id,
      title: document.title,
      path: document.path,
    },
  };
}

async function postActionToActiveViewer(
  item: AgentActionItem,
  pendingViewerActions: Map<string, (result: unknown) => void>,
  activeDocument: ViewerDocument | null | undefined,
  viewerAgentStates: Record<string, ViewerAgentState>,
) {
  if (!activeDocument || activeDocument.renderer !== "molstar") {
    return agentFailure(String(item.action?.type || ""), "NO_VIEWER", "No active Mol* viewer document is available.");
  }
  const agentState = viewerAgentStates[activeDocument.id];
  if (!agentState?.agentReady) {
    return agentFailure(String(item.action?.type || ""), "NO_VIEWER", "The active Mol* viewer has not reported BurreteAgent readiness yet.");
  }
  const iframe = activeDocument.id
    ? Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe.viewer-iframe[data-document-id]")).find(
        (item) => item.dataset.documentId === activeDocument.id,
      )
    : null;
  if (!iframe?.contentWindow) {
    return agentFailure(String(item.action?.type || ""), "NO_VIEWER", "No active viewer iframe is available.");
  }
  const result = await new Promise<unknown>((resolve) => {
    const timeout = window.setTimeout(() => {
      pendingViewerActions.delete(item.id);
      resolve(agentFailure(String(item.action?.type || ""), "ACTION_TIMEOUT", "The active viewer did not report an action result."));
    }, 5000);
    pendingViewerActions.set(item.id, (value) => {
      window.clearTimeout(timeout);
      resolve(value);
    });
    iframe.contentWindow?.postMessage({
      source: "burrete-agent-host",
      body: {
        type: "agent-action",
        id: item.id,
        action: item.action,
      },
    }, "*");
  });
  return result;
}

function viewerAgentStateFromMessage(body: { type?: unknown; message?: unknown; documentId?: unknown }, previous?: ViewerAgentState) {
  const documentId = typeof body.documentId === "string" ? body.documentId : "";
  if (!documentId) return null;
  const type = String(body.type || "");
  const message = typeof body.message === "string" ? body.message : null;
  const next: ViewerAgentState = {
    documentId,
    agentReady: previous?.agentReady ?? false,
    viewerReady: previous?.viewerReady ?? false,
    lastMessage: previous?.lastMessage ?? null,
    lastError: previous?.lastError ?? null,
    lastAction: previous?.lastAction ?? null,
    selection: previous?.selection ?? null,
    updatedAt: new Date().toISOString(),
  };
  if (type === "agentReady") {
    next.agentReady = true;
    next.viewerReady = true;
    next.lastMessage = message || "Burrete agent ready";
    next.lastError = null;
    return next;
  }
  if (type === "ready" || (type === "status" && message?.startsWith("[web] Rendered "))) {
    next.viewerReady = true;
    next.lastMessage = message || "Viewer ready";
    return next;
  }
  if (type === "error") {
    next.lastError = message || "Viewer reported an error.";
    next.lastMessage = message || next.lastMessage;
    return next;
  }
  return null;
}

function viewerAgentStateWithActionResult(
  documentId: string,
  previous: ViewerAgentState | undefined,
  result: unknown,
): ViewerAgentState {
  const object = typeof result === "object" && result !== null ? result as Record<string, unknown> : {};
  const ok = typeof object.ok === "boolean" ? object.ok : null;
  const command = typeof object.command === "string" ? object.command : null;
  const error = typeof object.error === "object" && object.error !== null ? object.error as Record<string, unknown> : null;
  const next: ViewerAgentState = {
    documentId,
    agentReady: previous?.agentReady ?? true,
    viewerReady: previous?.viewerReady ?? true,
    lastMessage: command ? `Action ${command} ${ok === false ? "failed" : "completed"}` : (previous?.lastMessage ?? null),
    lastError: ok === false && typeof error?.message === "string" ? error.message : null,
    lastAction: {
      ok,
      command,
      errorCode: typeof error?.code === "string" ? error.code : null,
      completedAt: new Date().toISOString(),
    },
    selection: sceneSelectionFromActionResult(result) ?? previous?.selection ?? null,
    updatedAt: new Date().toISOString(),
  };
  return next;
}

function sceneSelectionFromActionResult(result: unknown): AgentSceneSelection | null {
  if (typeof result !== "object" || result === null) return null;
  const outer = result as Record<string, unknown>;
  const payload = typeof outer.result === "object" && outer.result !== null ? outer.result as Record<string, unknown> : null;
  if (!payload) return null;
  const selectionId = typeof payload.selectionId === "string" ? payload.selectionId : null;
  const selector = payload.selectorEcho ?? null;
  const ligand = payload.ligand ?? null;
  const counts = payload.counts ?? null;
  if (!selectionId && !selector && !ligand && !counts) return null;
  return { selectionId, selector, ligand, counts };
}

function isFailedResult(result: unknown) {
  return typeof result === "object" && result !== null && "ok" in result && (result as { ok?: unknown }).ok === false;
}

function agentFailure(command: string, code: string, message: string) {
  return {
    ok: false,
    command,
    error: { code, message },
  };
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  const browserFile = browserAgentSessionFile(path);
  if (browserFile) {
    try {
      const response = await fetch(`/__burette/agent-session/${browserFile}`, { cache: "no-store" });
      if (!response.ok) return fallback;
      return await response.json() as T;
    } catch {
      return fallback;
    }
  }
  try {
    const file = await invoke<ReadTextFileResult>("read_text_file", { path });
    return JSON.parse(file.content) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown) {
  const browserFile = browserAgentSessionFile(path);
  if (browserFile) {
    const response = await fetch(`/__burette/agent-session/${browserFile}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!response.ok) {
      throw new Error(`Agent shell session write failed for ${browserFile}: HTTP ${response.status}`);
    }
    return;
  }
  await invoke<string>("write_text_file", {
    request: {
      outputPath: path,
      contents: `${JSON.stringify(value, null, 2)}\n`,
    },
  });
}

function joinSessionPath(sessionDir: string, fileName: string) {
  return `${sessionDir.replace(/\/+$/u, "")}/${fileName}`;
}

function isBrowserAgentSessionDir(sessionDir: string) {
  return sessionDir === BROWSER_AGENT_SESSION_DIR;
}

function browserAgentSessionFile(path: string) {
  const prefix = `${BROWSER_AGENT_SESSION_DIR}/`;
  if (!path.startsWith(prefix)) return null;
  const fileName = path.slice(prefix.length);
  return ["actions.json", "observe.json"].includes(fileName) ? fileName : null;
}

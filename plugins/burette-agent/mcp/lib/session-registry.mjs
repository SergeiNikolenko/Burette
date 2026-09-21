import { randomUUID } from "node:crypto";

const sessions = new Map();

export function createWorkspaceSession({ file, mode, result, structureSummary = null, observe = null }) {
  const workspaceSessionId = `bws_${randomUUID()}`;
  const session = normalizeSession({
    workspaceSessionId,
    file,
    mode,
    result,
    structureSummary,
    observe,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  sessions.set(workspaceSessionId, session);
  return session;
}

export function getWorkspaceSession(workspaceSessionId) {
  if (!workspaceSessionId) return null;
  return sessions.get(workspaceSessionId) || null;
}

export function updateWorkspaceSession(workspaceSessionId, patch) {
  const current = getWorkspaceSession(workspaceSessionId);
  if (!current) return null;
  const next = normalizeSession({
    ...current,
    ...patch,
    workspaceSessionId,
    updatedAt: new Date().toISOString(),
  });
  sessions.set(workspaceSessionId, next);
  return next;
}

export function listWorkspaceSessions() {
  return [...sessions.values()].map(session => ({
    workspaceSessionId: session.workspaceSessionId,
    viewerSessionId: session.workspaceSessionId,
    mode: session.mode,
    surface: session.surface,
    file: session.file,
    activeDocument: session.observe?.activeDocument || null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }));
}

export function resolveWorkspaceSession({ workspaceSessionId, viewerSessionId, url, sessionDir } = {}) {
  const requestedId = workspaceSessionId || viewerSessionId;
  const existing = getWorkspaceSession(requestedId);
  if (existing) return { ok: true, session: existing };
  if (url || sessionDir) {
    return {
      ok: true,
      session: normalizeSession({
        workspaceSessionId: requestedId || null,
        result: { url, sessionDir },
        mode: null,
      }),
    };
  }
  return {
    ok: false,
    error: {
      code: "WORKSPACE_SESSION_REQUIRED",
      message: "Provide workspaceSessionId, viewerSessionId, url, or sessionDir.",
    },
  };
}

function normalizeSession(session) {
  const result = session.result || {};
  const observe = session.observe || null;
  const mode = session.mode || result.mode || observe?.mode || null;
  return {
    workspaceSessionId: session.workspaceSessionId || null,
    mode,
    surface: surfaceFromMode(mode),
    file: session.file || result.file || result.initialPaths?.[0] || observe?.activeDocument?.path || null,
    url: result.url || session.url || null,
    sessionDir: result.sessionDir || session.sessionDir || null,
    result,
    structureSummary: session.structureSummary || null,
    observe,
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString(),
  };
}

function surfaceFromMode(mode) {
  if (mode === "desktop-app") return "desktop-app";
  if (mode === "browser-agent-shell" || mode === "browser-dev-shell") return "browser-agent-shell";
  if (mode === "browser-preview") return "browser-preview";
  return mode || "unknown";
}

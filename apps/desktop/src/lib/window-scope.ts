import { isHostedMcpWidget } from "./hosted-mcp-widget";
import { isTauriRuntime } from "./tauri";
import { hasExplicitBrowserDevServerWorkspace } from "./browser-dev-paths";

type WorkspaceStorageKeyOptions = {
  windowScoped?: boolean;
};

export function isNativePreviewWindow() {
  return typeof window !== "undefined" && Boolean(window.location) && new URLSearchParams(window.location.search)
    .get("buretteWindow")?.startsWith("workspace-preview-") === true;
}

function currentWindowStorageSuffix() {
  if (typeof window === "undefined" || !window.location) return "";
  if (window.BuretteMcpWorkspace) return `.mcp-${window.BuretteMcpWorkspace.sessionId}`;
  const windowLabel = new URLSearchParams(window.location.search).get("buretteWindow")?.trim() ?? "";
  if (!windowLabel || windowLabel === "main") return "";
  return `.${windowLabel.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

export function workspaceStorageKey(baseKey: string, options: WorkspaceStorageKeyOptions = {}) {
  if (options.windowScoped === false) return baseKey;
  return `${baseKey}${currentWindowStorageSuffix()}`;
}

/** Browser tabs retain their own workspace on reload without adopting another window's tabs. */
export function isBrowserSessionWorkspace() {
  return import.meta.env.VITE_BURETTE_AGENT_SHELL === "1"
    && typeof window !== "undefined" && !isTauriRuntime()
    && !window.BuretteMcpWorkspace && !isHostedMcpWidget() && !hasExplicitBrowserDevServerWorkspace()
    && import.meta.env.VITE_BURETTE_WEB_DEMO !== "1";
}

export function workspaceStorage() {
  return window.BuretteMcpWorkspace?.storage
    ?? (isBrowserSessionWorkspace() ? window.sessionStorage : localStorage);
}

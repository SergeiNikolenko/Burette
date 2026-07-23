import { dockingRequestForDrop } from "./docking-documents";
import { isTauriRuntime } from "./tauri";
import type { DockingDocumentRequest, DockingSceneMode } from "../types";
import { initializeWebDemoWorkspace, isWebDemoWorkspace } from "./web-demo-workspace";

export async function browserDevFilesFromLocation() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("quickLookFile")) return [];
  if (params.has("devDocking")) return [];
  if (params.has("devFiles")) {
    return params.getAll("devFiles").flatMap((value) => splitDevFiles(value));
  }
  const folders = browserDevFoldersFromParams(params);
  if (folders.length > 0) {
    const fileGroups = await Promise.all(folders.map(async (folder) => {
      const response = await fetch(`/__burette/dev-files?root=${encodeURIComponent(folder)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not load dev folder: ${response.status}`);
      const payload = await response.json() as { files?: string[] };
      return Array.isArray(payload.files) ? payload.files : [];
    }));
    return Array.from(new Set(fileGroups.flat()));
  }
  if (isWebDemoWorkspace()) return initializeWebDemoWorkspace();
  return [];
}

export function browserDevFoldersFromLocation() {
  if (typeof window === "undefined" || isTauriRuntime()) return [];
  return browserDevFoldersFromParams(new URLSearchParams(window.location.search));
}

export function browserDevFolderFromLocation() {
  return browserDevFoldersFromLocation()[0] ?? null;
}

export function splitDevFiles(rawFiles: string) {
  return rawFiles.split("\n").map((path) => path.trim()).filter(Boolean);
}

export function browserDevQuickLookFileFromLocation() {
  if (typeof window === "undefined" || isTauriRuntime()) return null;
  const params = new URLSearchParams(window.location.search);
  const path = params.get("quickLookFile")?.trim();
  return path || null;
}

export function browserDevHasExplicitFiles() {
  if (typeof window === "undefined" || isTauriRuntime()) return false;
  return new URLSearchParams(window.location.search).has("devFiles");
}

export function browserDevHasExplicitWorkspace() {
  if (typeof window === "undefined" || isTauriRuntime()) return false;
  const params = new URLSearchParams(window.location.search);
  return params.has("devFiles") || params.has("devFolder");
}

export function browserDevAgentFocusLayout(
  search = typeof window === "undefined" ? "" : window.location.search,
  isAgentShell = import.meta.env.VITE_BURRETE_AGENT_SHELL === "1",
) {
  if (!isAgentShell) return false;
  return new URLSearchParams(search).get("agentLayout") === "focus";
}

export function browserDevSceneModeFromLocation(): DockingSceneMode | null {
  const mode = new URLSearchParams(window.location.search).get("devScene")?.trim();
  return mode === "structureAll" || mode === "structurePoses" ? mode : null;
}

export function browserDevDockingFromLocation(): DockingDocumentRequest | null {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("devDocking")) return null;
  const paths = splitDevFiles(params.get("devDocking") ?? "");
  if (paths.length < 2) return null;
  return dockingRequestForDrop(paths[0], paths.slice(1));
}

function browserDevFoldersFromParams(params: URLSearchParams) {
  return Array.from(new Set(params.getAll("devFolder")
    .map(normalizeBrowserDevFolder)
    .filter((folder): folder is string => Boolean(folder))));
}

function normalizeBrowserDevFolder(folder: string | null) {
  const trimmed = folder?.trim();
  return trimmed ? trimmed.replace(/\\/g, "/").replace(/\/+$/u, "") : null;
}

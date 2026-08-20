import { dockingRequestForDrop } from "./docking-documents";
import { isTauriRuntime } from "./tauri";
import type { DockingDocumentRequest, DockingSceneMode } from "../types";
import { initializeWebDemoWorkspace, isWebDemoWorkspace } from "./web-demo-workspace";

// Vite's /@fs/ endpoint only serves absolute filesystem paths; a relative path
// falls through to the SPA fallback and index.html gets rendered as the file
// contents. Resolve every URL-provided dev path against the repo root before
// any consumer builds a /@fs/ URL from it.
const BROWSER_DEV_REPO_ROOT = String(import.meta.env.BURETTE_REPO_ROOT || "");

export function absoluteBrowserDevPath(path: string, repoRoot = BROWSER_DEV_REPO_ROOT) {
  const normalized = path.replace(/\\/g, "/");
  const root = repoRoot.replace(/\/+$/u, "");
  if (!root || normalized.startsWith("/")) return normalized;
  return `${root}/${normalized}`;
}

const BROWSER_DEV_FOLDER_ROOT_LIMIT = 16;
const BROWSER_DEV_FOLDER_FILE_LIMIT = 2_000;
const BROWSER_DEV_FOLDER_DIRECTORY_LIMIT = 400;
const BROWSER_DEV_FOLDER_ENTRY_LIMIT = 20_000;

export type BrowserDevFolderScan = {
  files: string[];
  truncated: boolean;
  scannedEntries: number;
  scannedDirectories: number;
};

export async function browserDevFilesFromLocation() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("quickLookFile")) return [];
  if (params.has("devDocking")) return [];
  if (params.has("devFiles")) {
    return params.getAll("devFiles").flatMap((value) => splitDevFiles(value)).map((path) => absoluteBrowserDevPath(path));
  }
  const folders = browserDevFoldersFromParams(params);
  if (folders.length > 0) {
    return (await scanBrowserDevFolders(folders)).files;
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
  return path ? absoluteBrowserDevPath(path) : null;
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
  isAgentShell = import.meta.env.VITE_BURETTE_AGENT_SHELL === "1",
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
  const paths = splitDevFiles(params.get("devDocking") ?? "").map((path) => absoluteBrowserDevPath(path));
  if (paths.length < 2) return null;
  return dockingRequestForDrop(paths[0], paths.slice(1));
}

function browserDevFoldersFromParams(params: URLSearchParams) {
  return Array.from(new Set(params.getAll("devFolder")
    .map(normalizeBrowserDevFolder)
    .filter((folder): folder is string => Boolean(folder))))
    .slice(0, BROWSER_DEV_FOLDER_ROOT_LIMIT);
}

export async function scanBrowserDevFolders(folders: string[]): Promise<BrowserDevFolderScan> {
  const files = new Set<string>();
  let truncated = folders.length > BROWSER_DEV_FOLDER_ROOT_LIMIT;
  let scannedEntries = 0;
  let scannedDirectories = 0;
  for (const root of folders.slice(0, BROWSER_DEV_FOLDER_ROOT_LIMIT)) {
    const remainingFiles = BROWSER_DEV_FOLDER_FILE_LIMIT - files.size;
    const remainingEntries = BROWSER_DEV_FOLDER_ENTRY_LIMIT - scannedEntries;
    const remainingDirectories = BROWSER_DEV_FOLDER_DIRECTORY_LIMIT - scannedDirectories;
    if (remainingFiles <= 0 || remainingEntries <= 0 || remainingDirectories <= 0) {
      truncated = true;
      break;
    }
    const query = new URLSearchParams({
      root,
      maxFiles: String(remainingFiles),
      maxEntries: String(remainingEntries),
      maxDirectories: String(remainingDirectories),
    });
    const response = await fetch(`/__burette/dev-files?${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load dev folder: ${response.status}`);
    const payload = await response.json() as Partial<BrowserDevFolderScan>;
    for (const path of Array.isArray(payload.files) ? payload.files : []) {
      if (files.size >= BROWSER_DEV_FOLDER_FILE_LIMIT) break;
      files.add(path);
    }
    scannedEntries += Math.max(0, Number(payload.scannedEntries) || 0);
    scannedDirectories += Math.max(0, Number(payload.scannedDirectories) || 0);
    if (payload.truncated === true) {
      truncated = true;
      break;
    }
  }
  return {
    files: Array.from(files),
    truncated,
    scannedEntries,
    scannedDirectories,
  };
}

function normalizeBrowserDevFolder(folder: string | null) {
  const trimmed = folder?.trim();
  return trimmed ? trimmed.replace(/\\/g, "/").replace(/\/+$/u, "") : null;
}

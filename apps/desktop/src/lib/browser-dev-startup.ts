import { dockingRequestForDrop } from "./docking-documents";
import { isTauriRuntime } from "./tauri";
import type { DockingDocumentRequest } from "../types";

export async function browserDevFilesFromLocation() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("quickLookFile")) return [];
  if (params.has("devDocking")) return [];
  if (params.has("devFiles")) {
    return params.getAll("devFiles").flatMap((value) => splitDevFiles(value));
  }
  if (params.has("devFolder")) {
    const folder = params.get("devFolder") ?? "";
    const response = await fetch(`/__burette/dev-files?root=${encodeURIComponent(folder)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load dev folder: ${response.status}`);
    const payload = await response.json() as { files?: string[] };
    return Array.isArray(payload.files) ? payload.files : [];
  }
  return [];
}

export function browserDevFolderFromLocation() {
  if (typeof window === "undefined" || isTauriRuntime()) return null;
  const folder = new URLSearchParams(window.location.search).get("devFolder")?.trim();
  return folder ? folder.replace(/\\/g, "/").replace(/\/+$/u, "") : null;
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

export function browserDevDockingFromLocation(): DockingDocumentRequest | null {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("devDocking")) return null;
  const paths = splitDevFiles(params.get("devDocking") ?? "");
  if (paths.length < 2) return null;
  return dockingRequestForDrop(paths[0], paths.slice(1));
}

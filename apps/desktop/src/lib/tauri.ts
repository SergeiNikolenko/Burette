import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  OpenDocumentsResult,
  ViewerPreferences,
  WorkspaceEntry,
  WorkspaceSearchResult,
} from "../types";
import type { WorkspaceSession } from "./session";

export function openDocuments(paths: string[], preferences: ViewerPreferences): Promise<OpenDocumentsResult> {
  return invoke("open_documents", { paths, preferences });
}

export function readDirectory(path: string): Promise<WorkspaceEntry[]> {
  return invoke("read_directory", { path });
}

export function searchWorkspace(workspaceRoot: string, query: string, limit = 30): Promise<WorkspaceSearchResult[]> {
  return invoke("search_workspace", { workspaceRoot, query, limit });
}

export function fileExists(path: string): Promise<boolean> {
  return invoke("file_exists", { path });
}

export function createEmptyFile(path: string): Promise<void> {
  return invoke("create_empty_file", { path });
}

export function createDirectory(path: string): Promise<void> {
  return invoke("create_directory", { path });
}

export function renameEntry(fromPath: string, toPath: string): Promise<void> {
  return invoke("rename_entry", { fromPath, toPath });
}

export function duplicateEntry(fromPath: string, toPath: string): Promise<void> {
  return invoke("duplicate_entry", { fromPath, toPath });
}

export function deleteEntry(path: string): Promise<void> {
  return invoke("delete_entry", { path });
}

export function revealPath(path: string): Promise<void> {
  return invoke("reveal_path", { path });
}

export function rememberWorkspace(path: string): Promise<string[]> {
  return invoke("remember_workspace", { path });
}

export function removeRecentWorkspace(path: string): Promise<string[]> {
  return invoke("remove_recent_workspace", { path });
}

export function getRecentWorkspaces(): Promise<string[]> {
  return invoke("get_recent_workspaces");
}

export type WorkspaceInfo = {
  root: string;
  name: string;
  fileCount: number;
};

export type RestoreWorkspaceResponse = {
  workspace: WorkspaceInfo;
  entries: WorkspaceEntry[];
  recentWorkspaces: string[];
  session: WorkspaceSession | null;
};

export type PendingOpenPayload = {
  workspace: string;
  file: string | null;
};

export function openWorkspace(path: string): Promise<WorkspaceInfo> {
  return invoke("open_workspace", { path });
}

export function restoreWorkspace(path: string): Promise<RestoreWorkspaceResponse> {
  return invoke("restore_workspace", { path });
}

export function takePendingOpen(): Promise<PendingOpenPayload | null> {
  return invoke("take_pending_open");
}

export function resolveOpenPayload(path: string): Promise<PendingOpenPayload | null> {
  return invoke("resolve_open_payload", { path });
}

export function openWorkspaceInNewWindow(path: string, file?: string | null): Promise<void> {
  return invoke("open_workspace_in_new_window", { path, file: file ?? null });
}

export function startupDocuments(): Promise<string[]> {
  return invoke("startup_documents");
}

export function startupOpenPayload(): Promise<PendingOpenPayload | null> {
  return invoke("startup_open_payload");
}

export function clearPreviewCache(): Promise<void> {
  return invoke("clear_preview_cache");
}

export function resetQuickLook(): Promise<void> {
  return invoke("reset_quick_look");
}

export function openLogsFolder(): Promise<void> {
  return invoke("open_logs_folder");
}

export function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
}

export type TitlebarDoubleClickAction = "maximize" | "minimize" | "none";

export function developmentInstanceName(): Promise<string | null> {
  return invoke("development_instance_name");
}

export function titlebarDoubleClickAction(): Promise<TitlebarDoubleClickAction> {
  return invoke("titlebar_double_click_action");
}

export function showMainWindow(): Promise<void> {
  return getCurrentWindow().show();
}

export function getSettings(): Promise<ViewerPreferences> {
  return invoke("get_settings");
}

export function getSetting<K extends keyof ViewerPreferences>(key: K): Promise<ViewerPreferences[K]> {
  return invoke("get_setting", { key });
}

export function setSetting<K extends keyof ViewerPreferences>(
  key: K,
  value: ViewerPreferences[K],
  scope = "global",
): Promise<void> {
  return invoke("set_setting", { key, value, scope });
}

export function resetSetting<K extends keyof ViewerPreferences>(
  key: K,
  scope = "global",
): Promise<void> {
  return invoke("reset_setting", { key, scope });
}

import { invoke } from "@tauri-apps/api/core";

export type WorkspaceSession = {
  paths: string[];
  activePath: string | null;
};

export function loadSession(workspaceRoot: string) {
  return invoke<WorkspaceSession | null>("load_session", { workspaceRoot });
}

export function saveSession(workspaceRoot: string, paths: string[], activePath: string | null) {
  return invoke("save_session", { workspaceRoot, paths, activePath });
}

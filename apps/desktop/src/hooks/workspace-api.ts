import type { DialogFilter } from "@tauri-apps/plugin-dialog";
import {
  loadSession,
  saveSession,
  type WorkspaceSession,
} from "../lib/session";
import * as tauri from "../lib/tauri";
import { isTauriRuntime } from "../lib/runtime";

export type { WorkspaceSession };

export const molecularStructureFilters: DialogFilter[] = [
  {
    name: "Molecular structures",
    extensions: ["pdb", "ent", "pdbqt", "pqr", "cif", "mcif", "mmcif", "bcif", "sdf", "sd", "smi", "smiles", "csv", "tsv", "mol", "mol2", "xyz", "gro", "cub", "cube", "in", "log", "out", "vasp"],
  },
];

export { isTauriRuntime };

export function parentDir(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : null;
}

export function basename(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path;
}

export function rememberWorkspace(path: string) {
  return tauri.rememberWorkspace(path);
}

export function openWorkspace(path: string) {
  return tauri.openWorkspace(path);
}

export function restoreWorkspace(path: string) {
  return tauri.restoreWorkspace(path);
}

export function openWorkspaceInNewWindow(path: string, file?: string | null) {
  return tauri.openWorkspaceInNewWindow(path, file);
}

export function removeRecentWorkspace(path: string) {
  return tauri.removeRecentWorkspace(path);
}

export function getRecentWorkspaces() {
  return tauri.getRecentWorkspaces();
}

export function loadWorkspaceSession(workspaceRoot: string) {
  return loadSession(workspaceRoot);
}

export function saveWorkspaceSession(workspaceRoot: string, paths: string[], activePath: string | null) {
  return saveSession(workspaceRoot, paths, activePath);
}

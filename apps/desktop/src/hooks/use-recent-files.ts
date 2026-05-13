import { useEffect, useMemo } from "react";
import type { RecentFile } from "../types";
import { isTauriRuntime } from "../lib/runtime";
import * as tauri from "../lib/tauri";

function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}

function isInWorkspace(path: string, workspaceRoot: string) {
  const root = normalizePath(workspaceRoot).replace(/\/+$/, "");
  const candidate = normalizePath(path);
  return candidate === root || candidate.startsWith(root + "/");
}

export function useRecentFiles(
  recentFiles: RecentFile[],
  workspaceRoot: string | null,
  pruneRecentFiles: (paths: string[]) => void,
) {
  const workspaceRecentFiles = useMemo(() => {
    if (!workspaceRoot) return [];
    return recentFiles
      .filter((entry) => isInWorkspace(entry.path, workspaceRoot))
      .sort((left, right) => right.openedAt - left.openedAt);
  }, [recentFiles, workspaceRoot]);

  useEffect(() => {
    if (!isTauriRuntime() || workspaceRecentFiles.length === 0) return;
    let cancelled = false;
    const candidates = workspaceRecentFiles.slice(0, 50);
    void Promise.all(
      candidates.map(async (entry) => ({
        path: entry.path,
        exists: await tauri.fileExists(entry.path).catch(() => true),
      })),
    ).then((results) => {
      if (cancelled) return;
      const stalePaths = results.filter((result) => !result.exists).map((result) => result.path);
      pruneRecentFiles(stalePaths);
    });
    return () => {
      cancelled = true;
    };
  }, [pruneRecentFiles, workspaceRecentFiles]);

  return workspaceRecentFiles;
}

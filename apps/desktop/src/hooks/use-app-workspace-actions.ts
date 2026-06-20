import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { parentDirectory } from "../lib/sidebar-projects";
import type { RecentStructure } from "../types";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type UseAppWorkspaceActionsOptions = {
  activeDocumentPath: string | null | undefined;
  activeProjectRoot: string | null | undefined;
  addProjectRoot: (path: string) => void;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  recentStructures: RecentStructure[];
  setWorkspacePath: (path: string | null) => void;
  workspacePath: string | null | undefined;
};

export function useAppWorkspaceActions({
  activeDocumentPath,
  activeProjectRoot,
  addProjectRoot,
  pushErrorStatus,
  pushStatus,
  recentStructures,
  setWorkspacePath,
  workspacePath,
}: UseAppWorkspaceActionsOptions) {
  const chooseWorkspace = useCallback(async () => {
    try {
      const selection = await open({ directory: true, multiple: false });
      if (!selection || Array.isArray(selection)) return;
      setWorkspacePath(selection);
      addProjectRoot(selection);
      pushStatus("Project folder added");
    } catch (error) {
      pushErrorStatus(error, "Workspace selection failed");
    }
  }, [addProjectRoot, pushErrorStatus, pushStatus, setWorkspacePath]);

  const openWorkspaceFolder = useCallback(async () => {
    const fallbackPath = activeProjectRoot ?? workspacePath ?? activeDocumentPath ?? recentStructures[0]?.path ?? null;
    if (!fallbackPath) {
      await chooseWorkspace();
      return;
    }
    const path = activeProjectRoot ?? workspacePath ?? parentDirectory(fallbackPath);
    if (!path) return;
    try {
      await openPath(path);
      pushStatus("Opened project folder");
    } catch (error) {
      pushErrorStatus(error, "Open project folder failed");
    }
  }, [activeDocumentPath, activeProjectRoot, chooseWorkspace, pushErrorStatus, pushStatus, recentStructures, workspacePath]);

  const openProjectFolder = useCallback(async (path: string | null) => {
    if (!path) return;
    try {
      await openPath(path);
      pushStatus("Opened project folder");
    } catch (error) {
      pushErrorStatus(error, "Open project folder failed");
    }
  }, [pushErrorStatus, pushStatus]);

  return {
    chooseWorkspace,
    openProjectFolder,
    openWorkspaceFolder,
  };
}

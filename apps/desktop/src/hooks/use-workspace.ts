import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { ViewerDocument, WorkspaceEntry } from "../types";
import {
  isTauriRuntime,
  getRecentWorkspaces,
  molecularStructureFilters,
  openWorkspace as openWorkspaceInBackend,
  openWorkspaceInNewWindow,
  parentDir,
  removeRecentWorkspace as removeRecentWorkspaceInBackend,
  restoreWorkspace as restoreWorkspaceInBackend,
} from "./workspace-api";

type UseWorkspaceOptions = {
  workspaceRoot: string | null;
  recentWorkspaces: string[];
  setWorkspaceRoot: (path: string | null) => void;
  setRecentWorkspaces: (paths: string[]) => void;
  setWorkspaceDirectory: (path: string, entries: WorkspaceEntry[]) => void;
  setActiveDocument: (id: string) => void;
  closeWorkspace: () => void;
  openDocuments: (paths: string[]) => Promise<ViewerDocument[]>;
  setStatus: (status: string) => void;
};

export function useWorkspace({
  workspaceRoot,
  recentWorkspaces,
  setWorkspaceRoot,
  setRecentWorkspaces,
  setWorkspaceDirectory,
  setActiveDocument,
  closeWorkspace,
  openDocuments,
  setStatus,
}: UseWorkspaceOptions) {
  const rememberWorkspace = useCallback(async (path: string) => {
    if (!isTauriRuntime()) {
      setWorkspaceRoot(path);
      return;
    }
    try {
      const workspace = await openWorkspaceInBackend(path);
      const recents = await getRecentWorkspaces();
      setWorkspaceRoot(workspace.root);
      setRecentWorkspaces(recents);
    } catch (error) {
      setStatus("Workspace open failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [setRecentWorkspaces, setStatus, setWorkspaceRoot]);

  const openWorkspace = useCallback(async (path: string) => {
    if (workspaceRoot && isTauriRuntime()) {
      try {
        await openWorkspaceInNewWindow(path);
        setStatus("Opened workspace in new window");
        return;
      } catch (error) {
        setStatus("New workspace window failed: " + (error instanceof Error ? error.message : String(error)));
        return;
      }
    }
    closeWorkspace();
    let session = null;
    if (isTauriRuntime()) {
      try {
        const restored = await restoreWorkspaceInBackend(path);
        setWorkspaceDirectory(restored.workspace.root, restored.entries);
        setWorkspaceRoot(restored.workspace.root);
        setRecentWorkspaces(restored.recentWorkspaces);
        session = restored.session;
      } catch (error) {
        setStatus("Workspace session restore failed: " + (error instanceof Error ? error.message : String(error)));
        await rememberWorkspace(path);
      }
    } else {
      await rememberWorkspace(path);
    }
    const paths = session?.paths.length ? session.paths : [];
    if (!paths.length) {
      setStatus("Opened workspace");
      return;
    }
    const opened = await openDocuments(paths);
    const activePath = session?.activePath;
    if (activePath) {
      const active = opened.find((document) => document.path === activePath);
      if (active) setActiveDocument(active.id);
    }
  }, [
    closeWorkspace,
    openDocuments,
    rememberWorkspace,
    setActiveDocument,
    setWorkspaceDirectory,
    setRecentWorkspaces,
    setStatus,
    setWorkspaceRoot,
    workspaceRoot,
  ]);

  const chooseFiles = useCallback(async () => {
    const selection = await open({ multiple: true, filters: molecularStructureFilters });
    const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
    if (paths.length > 0) {
      const root = parentDir(paths[0]);
      if (root) {
        if (workspaceRoot && root !== workspaceRoot && isTauriRuntime()) {
          try {
            await openWorkspaceInNewWindow(root, paths[0]);
            setStatus("Opened structure in new window");
          } catch (error) {
            setStatus("New workspace window failed: " + (error instanceof Error ? error.message : String(error)));
          }
          return;
        }
        await rememberWorkspace(root);
      }
    }
    await openDocuments(paths);
  }, [openDocuments, rememberWorkspace, setStatus, workspaceRoot]);

  const chooseFolder = useCallback(async () => {
    const selection = await open({ directory: true, multiple: false });
    if (typeof selection !== "string") return;
    await openWorkspace(selection);
  }, [openWorkspace]);

  const removeRecentWorkspace = useCallback(async (path: string) => {
    if (!isTauriRuntime()) {
      setRecentWorkspaces(recentWorkspaces.filter((candidate) => candidate !== path));
      return;
    }
    try {
      const recents = await removeRecentWorkspaceInBackend(path);
      setRecentWorkspaces(recents);
    } catch (error) {
      setStatus("Recent workspace removal failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [recentWorkspaces, setRecentWorkspaces, setStatus]);

  return {
    workspaceRoot,
    recentWorkspaces,
    rememberWorkspace,
    openWorkspace,
    chooseFiles,
    chooseFolder,
    removeRecentWorkspace,
  };
}

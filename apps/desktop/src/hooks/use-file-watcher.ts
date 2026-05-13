import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import * as editorApi from "./editor-api";
import { isTauriRuntime } from "./workspace-api";

type FileChangePayload = {
  path: string;
  kind: "modified" | "created" | "deleted" | "renamed";
};

type UseFileWatcherOptions = {
  workspaceRoot: string | null;
  openDocuments: (paths: string[]) => Promise<unknown>;
  closeDocument: (id: string) => void;
  setStatus: (status: string) => void;
};

function isInsideWorkspace(path: string, root: string) {
  return path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
}

function notifyWorkspaceFilesChanged() {
  window.dispatchEvent(new CustomEvent("burrete:workspace-files-changed"));
}

export function useFileWatcher({
  workspaceRoot,
  openDocuments,
  closeDocument,
  setStatus,
}: UseFileWatcherOptions) {
  useEffect(() => {
    if (!isTauriRuntime()) return;

    const unlistenFile = listen<FileChangePayload>("fs:file-changed", (event) => {
      const { path, kind } = event.payload;
      if (workspaceRoot && isInsideWorkspace(path, workspaceRoot)) {
        notifyWorkspaceFilesChanged();
      }

      const document = editorApi.getOpenDocumentByPath(path);
      if (!document) return;
      if (kind === "deleted") {
        closeDocument(document.id);
        return;
      }
      if (kind === "modified") {
        void openDocuments([path]);
      }
    });

    const unlistenDirectory = listen<FileChangePayload>("fs:directory-changed", (event) => {
      if (!workspaceRoot || isInsideWorkspace(event.payload.path, workspaceRoot)) {
        notifyWorkspaceFilesChanged();
      }
    });

    const unlistenIndexComplete = listen<number>("index:complete", () => {
      setStatus("Workspace index refreshed");
    });

    return () => {
      void unlistenFile.then((fn) => fn());
      void unlistenDirectory.then((fn) => fn());
      void unlistenIndexComplete.then((fn) => fn());
    };
  }, [closeDocument, openDocuments, setStatus, workspaceRoot]);
}

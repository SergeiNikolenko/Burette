import { useCallback, useEffect } from "react";
import type { DragEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DragDropEvent } from "@tauri-apps/api/window";
import * as tauri from "../lib/tauri";
import { isTauriRuntime } from "../lib/runtime";

function parentDir(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : null;
}

type UseOpenDropOptions = {
  workspaceRoot: string | null;
  openDocuments: (paths: string[]) => Promise<unknown>;
  openWorkspace: (path: string) => Promise<void>;
  rememberWorkspace: (path: string) => Promise<void>;
  setDropActive: (active: boolean) => void;
  setRecentWorkspaces: (paths: string[]) => void;
  setStatus: (status: string) => void;
};

export function useOpenDrop({
  workspaceRoot,
  openDocuments,
  openWorkspace,
  rememberWorkspace,
  setDropActive,
  setRecentWorkspaces,
  setStatus,
}: UseOpenDropOptions) {
  const openPayload = useCallback(async (payload: tauri.PendingOpenPayload) => {
    if (workspaceRoot && payload.workspace !== workspaceRoot) {
      await tauri.openWorkspaceInNewWindow(payload.workspace, payload.file);
      return;
    }
    await openWorkspace(payload.workspace);
    if (payload.file) {
      await openDocuments([payload.file]);
    }
  }, [openDocuments, openWorkspace, workspaceRoot]);

  const openDroppedPaths = useCallback(async (paths: string[]) => {
    if (isTauriRuntime()) {
      const payloads = (await Promise.all(paths.map((path) => tauri.resolveOpenPayload(path))))
        .filter((payload): payload is tauri.PendingOpenPayload => Boolean(payload));
      const firstPayload = payloads[0];
      if (firstPayload) {
        if (workspaceRoot && firstPayload.workspace !== workspaceRoot) {
          await tauri.openWorkspaceInNewWindow(firstPayload.workspace, firstPayload.file);
          return;
        }
        await openWorkspace(firstPayload.workspace);
        const files = payloads
          .filter((payload) => payload.workspace === firstPayload.workspace && payload.file)
          .map((payload) => payload.file as string);
        if (files.length > 0) {
          await openDocuments(files);
        }
        return;
      }
    }
    const root = paths[0] ? parentDir(paths[0]) : null;
    if (root) await rememberWorkspace(root);
    await openDocuments(paths);
  }, [openDocuments, openWorkspace, rememberWorkspace, workspaceRoot]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void (async () => {
      try {
        const recents = await tauri.getRecentWorkspaces();
        if (cancelled) return;
        setRecentWorkspaces(recents);
        const pending = await tauri.takePendingOpen();
        if (cancelled) return;
        if (pending) {
          await openPayload(pending);
          return;
        }
        const startupPayload = await tauri.startupOpenPayload();
        if (cancelled) return;
        if (startupPayload) {
          await openPayload(startupPayload);
          return;
        }
        const paths = await tauri.startupDocuments();
        if (cancelled) return;
        if (paths.length > 0) {
          await openDroppedPaths(paths);
          return;
        }
        if (recents[0]) {
          await openWorkspace(recents[0]);
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        void tauri.showMainWindow().catch((error) => {
          setStatus("Window show failed: " + (error instanceof Error ? error.message : String(error)));
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openDroppedPaths, openPayload, openWorkspace, setRecentWorkspaces, setStatus]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void listen<tauri.PendingOpenPayload>("open:from-drop", (event) => {
      void (async () => {
        const pending = await tauri.takePendingOpen();
        await openPayload(pending ?? event.payload);
      })().catch((error) => {
        setStatus("Open request failed: " + (error instanceof Error ? error.message : String(error)));
      });
    }).then((next) => {
      unlisten = next;
    });
    return () => {
      unlisten?.();
    };
  }, [openPayload, setStatus]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void listen<string[]>("open-documents", (event) => {
      void openDroppedPaths(event.payload);
    }).then((next) => {
      unlisten = next;
    });
    return () => {
      unlisten?.();
    };
  }, [openDroppedPaths]);

  const handleFileDrop = useCallback(
    (event: DragDropEvent) => {
      if (event.type === "enter" || event.type === "over") {
        setDropActive(true);
        return;
      }
      setDropActive(false);
      if (event.type === "drop") {
        void openDroppedPaths(event.paths);
      }
    },
    [openDroppedPaths, setDropActive],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onDragDropEvent((event) => {
      handleFileDrop(event.payload);
    }).then((next) => {
      unlisten = next;
    }).catch((error) => {
      setStatus("File drop setup failed: " + (error instanceof Error ? error.message : String(error)));
    });
    return () => {
      unlisten?.();
    };
  }, [handleFileDrop, setStatus]);

  const handleBrowserDrag = useCallback((event: DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }, [setDropActive]);

  const handleBrowserDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropActive(false);
  }, [setDropActive]);

  const handleBrowserDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    setDropActive(false);
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path));
    if (paths.length > 0) {
      void openDroppedPaths(paths);
    } else if (!isTauriRuntime()) {
      setStatus("Drop files into the installed app window to open them.");
    }
  }, [openDroppedPaths, setDropActive, setStatus]);

  return {
    handleBrowserDrag,
    handleBrowserDragLeave,
    handleBrowserDrop,
  };
}

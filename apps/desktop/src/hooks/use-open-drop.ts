import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DragDropEvent } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../lib/tauri";

type OpenDocuments = (paths: string[]) => void | Promise<void>;

export function useOpenDrop(openDocuments: OpenDocuments, setStatus: (status: string) => void) {
  const [dropActive, setDropActive] = useState(false);

  const handleFileDrop = useCallback(
    (event: DragDropEvent) => {
      if (event.type === "enter" || event.type === "over") {
        setDropActive(true);
        return;
      }
      setDropActive(false);
      if (event.type === "drop") {
        void openDocuments(event.paths);
      }
    },
    [openDocuments],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        handleFileDrop(event.payload);
      })
      .then((next) => {
        unlisten = next;
      })
      .catch((error) => {
        setStatus("File drop setup failed: " + (error instanceof Error ? error.message : String(error)));
      });

    return () => {
      unlisten?.();
    };
  }, [handleFileDrop, setStatus]);

  const handleBrowserDrag = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }, []);

  const handleBrowserDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropActive(false);
  }, []);

  const handleBrowserDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      setDropActive(false);
      const paths = Array.from(event.dataTransfer.files)
        .map((file) => (file as File & { path?: string }).path)
        .filter((path): path is string => Boolean(path));
      if (paths.length > 0) {
        void openDocuments(paths);
      } else if (!isTauriRuntime()) {
        setStatus("Drop files into the installed app window to open them.");
      }
    },
    [openDocuments, setStatus],
  );

  return {
    dropActive,
    handleBrowserDrag,
    handleBrowserDragLeave,
    handleBrowserDrop,
  };
}

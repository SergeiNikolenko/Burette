import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DragDropEvent } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../lib/tauri";

type OpenDocuments = (paths: string[]) => void | Promise<void>;

export function useOpenDrop(openDocuments: OpenDocuments, setStatus: (status: string) => void) {
  const [dropActive, setDropActive] = useState(false);
  const dropResetTimerRef = useRef<number | undefined>(undefined);

  const clearDropResetTimer = useCallback(() => {
    if (dropResetTimerRef.current === undefined) return;
    window.clearTimeout(dropResetTimerRef.current);
    dropResetTimerRef.current = undefined;
  }, []);

  const hideDropOverlay = useCallback(() => {
    clearDropResetTimer();
    setDropActive(false);
  }, [clearDropResetTimer]);

  const showDropOverlay = useCallback(() => {
    setDropActive(true);
    clearDropResetTimer();
    dropResetTimerRef.current = window.setTimeout(() => {
      dropResetTimerRef.current = undefined;
      setDropActive(false);
    }, 1200);
  }, [clearDropResetTimer]);

  const handleFileDrop = useCallback(
    (event: DragDropEvent) => {
      if (event.type === "enter" || event.type === "over") {
        showDropOverlay();
        return;
      }
      hideDropOverlay();
      if (event.type === "drop") {
        void openDocuments(event.paths);
      }
    },
    [hideDropOverlay, openDocuments, showDropOverlay],
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

  useEffect(() => {
    const resetDropState = () => hideDropOverlay();
    const resetWhenHidden = () => {
      if (document.visibilityState === "hidden") hideDropOverlay();
    };

    window.addEventListener("blur", resetDropState);
    window.addEventListener("dragend", resetDropState);
    document.addEventListener("visibilitychange", resetWhenHidden);
    return () => {
      clearDropResetTimer();
      window.removeEventListener("blur", resetDropState);
      window.removeEventListener("dragend", resetDropState);
      document.removeEventListener("visibilitychange", resetWhenHidden);
    };
  }, [clearDropResetTimer, hideDropOverlay]);

  const handleBrowserDrag = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    showDropOverlay();
  }, [showDropOverlay]);

  const handleBrowserDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    hideDropOverlay();
  }, [hideDropOverlay]);

  const handleBrowserDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      hideDropOverlay();
      const paths = Array.from(event.dataTransfer.files)
        .map((file) => (file as File & { path?: string }).path)
        .filter((path): path is string => Boolean(path));
      if (paths.length > 0) {
        void openDocuments(paths);
      } else if (!isTauriRuntime()) {
        setStatus("Drop files into the installed app window to open them.");
      }
    },
    [hideDropOverlay, openDocuments, setStatus],
  );

  return {
    dropActive,
    handleBrowserDrag,
    handleBrowserDragLeave,
    handleBrowserDrop,
  };
}

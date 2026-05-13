import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../lib/tauri";

type OpenDocuments = (paths: string[]) => void | Promise<void>;

export function useOpenEvents(openDocuments: OpenDocuments, setStatus: (status: string) => void) {
  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    void invoke<string[]>("startup_documents")
      .then((paths) => {
        if (paths.length > 0) void openDocuments(paths);
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error));
      });

    let unlisten: (() => void) | undefined;
    void listen<string[]>("open-documents", (event) => {
      void openDocuments(event.payload);
    }).then((next) => {
      unlisten = next;
    });

    return () => {
      unlisten?.();
    };
  }, [openDocuments, setStatus]);
}

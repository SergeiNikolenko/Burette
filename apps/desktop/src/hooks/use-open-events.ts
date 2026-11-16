import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime, trackTauriListener } from "../lib/tauri";

type OpenDocuments = (paths: string[]) => void | Promise<void>;

export function useOpenEvents(
  openDocuments: OpenDocuments,
  pushErrorStatus: (error: unknown, prefix?: string) => void,
) {
  const [startupOpenSettled, setStartupOpenSettled] = useState(!isTauriRuntime());

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    const openPendingDocuments = (settle = false) => {
      void invoke<string[]>("startup_documents")
        .then((paths) => {
          if (paths.length > 0) return openDocuments(paths);
        })
        .catch((error) => {
          pushErrorStatus(error, "Startup open failed");
        })
        .finally(() => {
          if (settle) setStartupOpenSettled(true);
        });
    };

    const cleanup = trackTauriListener(
      listen("open-documents", () => {
        openPendingDocuments();
      }),
      "open-documents",
      () => openPendingDocuments(true),
    );

    return () => {
      cleanup();
    };
  }, [openDocuments, pushErrorStatus]);

  return startupOpenSettled;
}

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime, trackTauriListener } from "../lib/tauri";

type OpenDocumentsOptions = { replace?: boolean };
type OpenDocuments = (paths: string[], options?: OpenDocumentsOptions) => void | Promise<void>;

export function useOpenEvents(
  openDocuments: OpenDocuments,
  pushErrorStatus: (error: unknown, prefix?: string) => void,
) {
  const [startupOpenSettled, setStartupOpenSettled] = useState(!isTauriRuntime());

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    const openPendingDocuments = (options: OpenDocumentsOptions = {}, settle = false) => {
      void invoke<string[]>("startup_documents")
        .then((paths) => {
          if (paths.length > 0) void openDocuments(paths, options);
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
      }).then((unlisten) => {
        openPendingDocuments({ replace: true }, true);
        return unlisten;
      }),
      "open-documents",
    );

    return () => {
      cleanup();
    };
  }, [openDocuments, pushErrorStatus]);

  return startupOpenSettled;
}

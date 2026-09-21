import { useCallback, useEffect, useRef, useState } from "react";

import { isTauriRuntime } from "../lib/tauri";
import type { ViewerDocument } from "../types";

type UseAppQuickLookArgs = {
  browserDevQuickLookPath: string | null;
  openQuickLookDocument: (path: string) => Promise<ViewerDocument | null>;
  pushErrorStatus: (error: unknown, prefix?: string, details?: string[]) => void;
};

export function useAppQuickLook({
  browserDevQuickLookPath,
  openQuickLookDocument,
  pushErrorStatus,
}: UseAppQuickLookArgs) {
  const [quickLookDocument, setQuickLookDocument] = useState<ViewerDocument | null>(null);
  const [quickLookError, setQuickLookError] = useState<string | null>(null);
  const openedBrowserDevQuickLookRef = useRef<string | null>(null);

  useEffect(() => {
    const quickLookPath = browserDevQuickLookPath;
    if (!quickLookPath || openedBrowserDevQuickLookRef.current === quickLookPath) return;
    let cancelled = false;
    openedBrowserDevQuickLookRef.current = quickLookPath;
    setQuickLookDocument(null);
    setQuickLookError(null);
    void openQuickLookDocument(quickLookPath).then((document) => {
      if (cancelled) return;
      if (document) {
        setQuickLookDocument(document);
        return;
      }
      setQuickLookError("Quick Look debug file did not produce a preview document.");
    }).catch((error) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      setQuickLookError(`Open Quick Look debug file failed: ${message}`);
      pushErrorStatus(error, "Open Quick Look debug file failed");
    });
    return () => {
      cancelled = true;
    };
  }, [browserDevQuickLookPath, openQuickLookDocument, pushErrorStatus]);

  const closeQuickLookPreview = useCallback(() => {
    if (browserDevQuickLookPath) {
      openedBrowserDevQuickLookRef.current = null;
      if (!isTauriRuntime()) {
        const url = new URL(window.location.href);
        url.searchParams.delete("quickLookFile");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
    }
    setQuickLookDocument(null);
    setQuickLookError(null);
  }, [browserDevQuickLookPath]);

  return {
    closeQuickLookPreview,
    quickLookDocument,
    quickLookError,
    quickLookStandalone: Boolean(browserDevQuickLookPath),
  };
}

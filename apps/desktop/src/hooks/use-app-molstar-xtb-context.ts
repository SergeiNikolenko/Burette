import { useCallback } from "react";

import { openBrowserDevMolstarContextDocument } from "../lib/browser-dev-documents";
import type { ActiveViewerIframeForDocument, KnownViewerMessageSource } from "../lib/viewer-bridge";
import type { ViewerDocument } from "../types";

type MolstarContextDocument = Parameters<typeof openBrowserDevMolstarContextDocument>[0];

type UseAppMolstarXtbContextOptions = {
  activeViewerIframeForDocument: ActiveViewerIframeForDocument;
  isKnownViewerMessageSource: KnownViewerMessageSource;
};

export function useAppMolstarXtbContext({
  activeViewerIframeForDocument,
  isKnownViewerMessageSource,
}: UseAppMolstarXtbContextOptions) {
  const requestMolstarXtbContextDocument = useCallback(async (document: ViewerDocument): Promise<MolstarContextDocument | null> => {
    if (document.renderer !== "molstar") return null;
    const iframe = activeViewerIframeForDocument(document.id);
    if (!iframe?.contentWindow) throw new Error("Open the structure viewer and wait for it to load before retrying the calculation.");
    const viewerWindow = iframe.contentWindow;
    const actionId = `xtb-context-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
      };
      const onMessage = (event: MessageEvent) => {
        const data = event.data;
        const body = data?.body;
        if (data?.source !== "burette-agent-viewer" || body?.type !== "agent-action-result" || body.id !== actionId) return;
        if (event.source !== viewerWindow || !isKnownViewerMessageSource(event.source, document.id)) return;
        const contextDocument = body.result?.result?.contextDocument;
        cleanup();
        const validContext = contextDocument === null || (
          contextDocument && Array.isArray(contextDocument.entries)
          && contextDocument.entries.some((entry: { data?: unknown } | null) => typeof entry?.data === "string" && entry.data.trim())
        );
        if (body.result?.ok !== true || !validContext) {
          reject(new Error("The viewer could not extract the calculation input. Check the selection and retry."));
          return;
        }
        resolve(contextDocument);
      };
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("The structure viewer did not respond. Wait for it to finish loading, then retry the calculation."));
      }, 5000);
      window.addEventListener("message", onMessage);
      try {
        viewerWindow.postMessage({
          source: "burette-agent-host",
          body: {
            type: "agent-action",
            id: actionId,
            action: { type: "get_xtb_context" },
          },
        }, "*");
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }, [activeViewerIframeForDocument, isKnownViewerMessageSource]);

  return { requestMolstarXtbContextDocument };
}

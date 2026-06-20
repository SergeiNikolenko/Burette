import { useCallback } from "react";

import { openBrowserDevMolstarContextDocument } from "../lib/browser-dev-documents";
import type { ViewerDocument } from "../types";

type MolstarContextDocument = Parameters<typeof openBrowserDevMolstarContextDocument>[0];
type ActiveViewerIframeForDocument = (documentId: string) => HTMLIFrameElement | null;
type KnownViewerMessageSource = (source: MessageEventSource | null, documentId?: string) => boolean;

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
    if (!iframe?.contentWindow) return null;
    const actionId = `xtb-context-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const finish = (contextDocument: MolstarContextDocument | null) => {
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(contextDocument);
      };
      const onMessage = (event: MessageEvent) => {
        const data = event.data;
        const body = data?.body;
        if (data?.source !== "burrete-agent-viewer" || body?.type !== "agent-action-result" || body.id !== actionId) return;
        if (!isKnownViewerMessageSource(event.source, document.id)) return;
        const contextDocument = body.result?.result?.contextDocument;
        finish(contextDocument && typeof contextDocument === "object" ? contextDocument : null);
      };
      const timeout = window.setTimeout(() => finish(null), 500);
      window.addEventListener("message", onMessage);
      iframe.contentWindow?.postMessage({
        source: "burrete-agent-host",
        body: {
          type: "agent-action",
          id: actionId,
          action: { type: "get_xtb_context" },
        },
      }, "*");
    });
  }, [activeViewerIframeForDocument, isKnownViewerMessageSource]);

  return { requestMolstarXtbContextDocument };
}

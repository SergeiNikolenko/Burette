import { useEffect, useRef } from "react";

import {
  deleteBrowserDevVirtualTextDocument,
  openBrowserDevMolstarContextDocument,
} from "../lib/browser-dev-documents";
import {
  isHostedMcpWidget,
  isHostedMcpToolResultMessage,
  parseHostedMcpStructureMessage,
  parseHostedMcpStructureResult,
  selectHostedMcpInitialStructure,
  type HostedMcpStructure,
} from "../lib/hosted-mcp-widget";
import type { ViewerDocument, ViewerPreferences } from "../types";

type UseHostedMcpWidgetOptions = {
  addDocuments: (documents: ViewerDocument[]) => void;
  closeAllDocuments: () => void;
  preferences: ViewerPreferences;
  pushErrorStatus: (error: unknown, prefix?: string) => void;
};

export function useHostedMcpWidget({
  addDocuments,
  closeAllDocuments,
  preferences,
  pushErrorStatus,
}: UseHostedMcpWidgetOptions) {
  const openedDocumentPathRef = useRef<string | null>(null);
  const openedStructureRef = useRef<HostedMcpStructure | null>(null);
  const openSequenceRef = useRef(0);

  useEffect(() => {
    if (!isHostedMcpWidget()) return undefined;
    document.documentElement.dataset.hostedMcpWidget = "true";

    const forgetOpenedDocument = () => {
      if (!openedDocumentPathRef.current) return;
      deleteBrowserDevVirtualTextDocument(openedDocumentPathRef.current);
      openedDocumentPathRef.current = null;
    };

    const clearOpenedStructure = () => {
      openSequenceRef.current += 1;
      openedStructureRef.current = null;
      forgetOpenedDocument();
      closeAllDocuments();
    };

    const openStructure = (structure: HostedMcpStructure) => {
      const opened = openedStructureRef.current;
      if (
        opened?.label === structure.label
        && opened.format === structure.format
        && opened.data === structure.data
        && JSON.stringify(opened.source) === JSON.stringify(structure.source)
        && JSON.stringify(opened.actions) === JSON.stringify(structure.actions)
      ) return;

      openedStructureRef.current = structure;
      window.BurreteHostedAppBridge?.setSource(structure.source);
      void window.BurreteHostedAppBridge?.updateSelection(null, "active-structure");
      openSequenceRef.current += 1;
      const sequence = openSequenceRef.current;
      forgetOpenedDocument();
      closeAllDocuments();
      void openBrowserDevMolstarContextDocument({
        label: structure.label,
        context: {
          hostedMcpWidget: true,
          hostedMcpActions: structure.actions,
        },
        entries: [{
          role: "structure",
          label: structure.label,
          format: structure.format,
          data: structure.data,
        }],
      }, {
        ...preferences,
        rendererMode: "molstar",
      })
        .then((viewerDocument) => {
          if (sequence !== openSequenceRef.current) {
            deleteBrowserDevVirtualTextDocument(viewerDocument.path);
            return;
          }
          openedDocumentPathRef.current = viewerDocument.path;
          addDocuments([viewerDocument]);
        })
        .catch((error) => {
          if (sequence !== openSequenceRef.current) return;
          openedStructureRef.current = null;
          pushErrorStatus(error, "Hosted molecular viewer failed");
        });
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!isHostedMcpToolResultMessage(event.data)) return;
      const structure = parseHostedMcpStructureMessage(event.data);
      if (structure) openStructure(structure);
      else clearOpenedStructure();
    };
    const onOpenAiGlobals = (event: Event) => {
      const globals = (event as CustomEvent<{ globals?: {
        toolOutput?: unknown;
        toolResponseMetadata?: unknown;
      } }>).detail?.globals;
      if (globals?.toolOutput === undefined) return;
      const structure = parseHostedMcpStructureResult({
        structuredContent: globals.toolOutput,
        _meta: globals.toolResponseMetadata,
      });
      if (structure) openStructure(structure);
      else clearOpenedStructure();
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("openai:set_globals", onOpenAiGlobals);
    window.__BURRETE_HOSTED_MCP_BRIDGE_READY__ = true;

    const queuedResults = window.__BURRETE_HOSTED_MCP_RESULTS__?.splice(0) ?? [];
    const initialStructure = selectHostedMcpInitialStructure(
      queuedResults,
      window.openai?.toolOutput !== undefined ? {
        structuredContent: window.openai.toolOutput,
        _meta: window.openai.toolResponseMetadata,
      } : undefined,
    );
    if (initialStructure) openStructure(initialStructure);
    else if (queuedResults.length > 0 || window.openai?.toolOutput !== undefined) {
      clearOpenedStructure();
    }

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("openai:set_globals", onOpenAiGlobals);
      window.__BURRETE_HOSTED_MCP_BRIDGE_READY__ = false;
      window.__BURRETE_HOSTED_MCP_RESULTS__ = [];
      forgetOpenedDocument();
      delete document.documentElement.dataset.hostedMcpWidget;
    };
  }, [addDocuments, closeAllDocuments, preferences, pushErrorStatus]);
}

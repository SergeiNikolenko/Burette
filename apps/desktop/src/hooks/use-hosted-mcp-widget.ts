import { useEffect, useRef } from "react";

import {
  deleteBrowserDevVirtualTextDocument,
  openBrowserDevMolstarContextDocument,
} from "../lib/browser-dev-documents";
import {
  isHostedKetcherWidget,
  isHostedMcpWidget,
  isHostedMcpToolResultMessage,
  isHostedMcpStructureFailure,
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
  const receivedStructureRef = useRef<HostedMcpStructure | null>(null);
  const openSequenceRef = useRef(0);

  useEffect(() => {
    if (!isHostedMcpWidget()) return undefined;
    document.documentElement.dataset.hostedMcpWidget = "true";
    // Ketcher results carry no 3D structure, so the handlers below would read
    // every one as "clear the viewer" and close the Ketcher tab the app opens.
    // ChatGPT exposes window.openai.toolOutput before the first render, which
    // made that happen at mount. The Ketcher page consumes its seed itself.
    if (isHostedKetcherWidget()) {
      return () => {
        delete document.documentElement.dataset.hostedMcpWidget;
      };
    }

    const forgetOpenedDocument = () => {
      if (!openedDocumentPathRef.current) return;
      deleteBrowserDevVirtualTextDocument(openedDocumentPathRef.current);
      openedDocumentPathRef.current = null;
    };

    const clearOpenedStructure = () => {
      openSequenceRef.current += 1;
      openedStructureRef.current = null;
      receivedStructureRef.current = null;
      forgetOpenedDocument();
      closeAllDocuments();
    };

    const openStructure = (structure: HostedMcpStructure) => {
      receivedStructureRef.current = structure;
      const opened = openedStructureRef.current;
      if (
        opened?.label === structure.label
        && opened.format === structure.format
        && opened.data === structure.data
        && JSON.stringify(opened.source) === JSON.stringify(structure.source)
        && JSON.stringify(opened.actions) === JSON.stringify(structure.actions)
      ) return;

      openedStructureRef.current = structure;
      window.BuretteHostedAppBridge?.setSource(structure.source);
      void window.BuretteHostedAppBridge?.updateSelection(null, "active-structure");
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
      if (isHostedMcpStructureFailure(event.data.params ?? event.data.result)) {
        clearOpenedStructure();
        return;
      }
      const structure = parseHostedMcpStructureMessage(event.data);
      if (structure) openStructure(structure);
    };
    // The host may deliver output and widget-only metadata in separate events.
    // Keep their latest values instead of treating an incomplete delta as clear.
    const globalsSnapshot: { toolOutput?: unknown; toolResponseMetadata?: unknown } = {
      ...window.__BURETTE_HOSTED_OPENAI_GLOBALS__,
      ...(window.openai?.toolOutput !== undefined ? { toolOutput: window.openai.toolOutput } : {}),
      ...(window.openai?.toolResponseMetadata !== undefined
        ? { toolResponseMetadata: window.openai.toolResponseMetadata } : {}),
    };
    const onOpenAiGlobals = (event: Event) => {
      const globals = (event as CustomEvent<{ globals?: {
        toolOutput?: unknown;
        toolResponseMetadata?: unknown;
      } }>).detail?.globals;
      if (!globals) return;
      if (Object.hasOwn(globals, "toolOutput")) globalsSnapshot.toolOutput = globals.toolOutput;
      if (Object.hasOwn(globals, "toolResponseMetadata")) {
        globalsSnapshot.toolResponseMetadata = globals.toolResponseMetadata;
      }
      if (!Object.hasOwn(globals, "toolOutput") && !Object.hasOwn(globals, "toolResponseMetadata")) return;
      const result = {
        structuredContent: globalsSnapshot.toolOutput,
        _meta: globalsSnapshot.toolResponseMetadata,
      };
      const structure = parseHostedMcpStructureResult(result);
      if (isHostedMcpStructureFailure(result)) { clearOpenedStructure(); return; }
      if (structure) openStructure(structure);
      // Missing metadata is not a failed/empty tool result. A complete MCP
      // error still clears the scene through onMessage above.
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("openai:set_globals", onOpenAiGlobals);
    window.__BURETTE_HOSTED_MCP_BRIDGE_READY__ = true;

    const queuedResults = window.__BURETTE_HOSTED_MCP_RESULTS__?.splice(0) ?? [];
    const snapshotResult = { structuredContent: globalsSnapshot.toolOutput, _meta: globalsSnapshot.toolResponseMetadata };
    const initialStructure = selectHostedMcpInitialStructure(
      queuedResults,
      snapshotResult,
    );
    if (initialStructure) openStructure(initialStructure);
    else if (!queuedResults.some(isHostedMcpStructureFailure)
      && !isHostedMcpStructureFailure(snapshotResult) && receivedStructureRef.current) {
      // MCP-only hosts have no window.openai snapshot after the initial queue
      // is consumed. Restore the last received payload on effect restart.
      openStructure(receivedStructureRef.current);
    }
    else if (queuedResults.length > 0 || window.openai?.toolOutput !== undefined) {
      clearOpenedStructure();
    }

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("openai:set_globals", onOpenAiGlobals);
      window.__BURETTE_HOSTED_MCP_BRIDGE_READY__ = false;
      window.__BURETTE_HOSTED_MCP_RESULTS__ = [];
      openSequenceRef.current += 1;
      openedStructureRef.current = null;
      forgetOpenedDocument();
      delete document.documentElement.dataset.hostedMcpWidget;
    };
  }, [addDocuments, closeAllDocuments, preferences, pushErrorStatus]);
}

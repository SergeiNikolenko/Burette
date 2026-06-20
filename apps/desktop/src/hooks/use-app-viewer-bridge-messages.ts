import { useEffect } from "react";

import type { KnownViewerMessageSource } from "../lib/viewer-bridge";

type ViewerBridgeMessageSource = "burrete-viewer" | "burrete-grid" | "burrete-agent-viewer";
type ViewerBridgeMessageBody = (Record<string, unknown> & { documentId?: string }) | null | undefined;
type ViewerBridgeMessageData = {
  source?: string;
  body?: ViewerBridgeMessageBody;
} | undefined;
type SourceMessageHandler = (source: ViewerBridgeMessageSource, body: ViewerBridgeMessageBody) => boolean;
type SourceEventMessageHandler = (
  source: ViewerBridgeMessageSource,
  body: ViewerBridgeMessageBody,
  eventSource: MessageEventSource | null,
) => boolean;
type BodyMessageHandler = (body: ViewerBridgeMessageBody) => boolean;
type BodyEventMessageHandler = (body: ViewerBridgeMessageBody, eventSource: MessageEventSource | null) => boolean;
type AsyncBodyMessageHandler = (body: ViewerBridgeMessageBody) => Promise<boolean>;
type FirstRenderMessageHandler = (source: ViewerBridgeMessageSource, body: ViewerBridgeMessageBody) => void;

type UseAppViewerBridgeMessagesOptions = {
  handleDockingPoseMessage: SourceMessageHandler;
  handleGridConformerMessage: BodyEventMessageHandler;
  handleGridControlMessage: BodyMessageHandler;
  handleGridFileMessage: BodyEventMessageHandler;
  handleGridRuntimeMessage: BodyEventMessageHandler;
  handleKetcherViewerMessage: BodyMessageHandler;
  handleMolstarContextMessage: BodyMessageHandler;
  handleRendererMessage: BodyMessageHandler;
  handleSdfViewerMessage: AsyncBodyMessageHandler;
  handleViewerConformerMessage: BodyEventMessageHandler;
  handleViewerFileMessage: BodyMessageHandler;
  handleViewerHostMessage: SourceMessageHandler;
  handleViewerRuntimeFileMessage: SourceEventMessageHandler;
  handleViewerRuntimeMessage: BodyMessageHandler;
  handleViewerStateMessage: SourceMessageHandler;
  handleXyzrenderSheetMessage: SourceEventMessageHandler;
  isKnownViewerMessageSource: KnownViewerMessageSource;
  markViewerFirstRenderMessage: FirstRenderMessageHandler;
};

function viewerBridgeSource(value: string | undefined): ViewerBridgeMessageSource | null {
  return value === "burrete-viewer" || value === "burrete-grid" || value === "burrete-agent-viewer"
    ? value
    : null;
}

export function useAppViewerBridgeMessages({
  handleDockingPoseMessage,
  handleGridConformerMessage,
  handleGridControlMessage,
  handleGridFileMessage,
  handleGridRuntimeMessage,
  handleKetcherViewerMessage,
  handleMolstarContextMessage,
  handleRendererMessage,
  handleSdfViewerMessage,
  handleViewerConformerMessage,
  handleViewerFileMessage,
  handleViewerHostMessage,
  handleViewerRuntimeFileMessage,
  handleViewerRuntimeMessage,
  handleViewerStateMessage,
  handleXyzrenderSheetMessage,
  isKnownViewerMessageSource,
  markViewerFirstRenderMessage,
}: UseAppViewerBridgeMessagesOptions) {
  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const data = event.data as ViewerBridgeMessageData;
      const source = viewerBridgeSource(data?.source);
      if (!source) return;
      const body = data?.body;
      if (!isKnownViewerMessageSource(event.source, body?.documentId)) return;
      if (handleViewerHostMessage(source, body)) {
        return;
      }
      if (handleViewerStateMessage(source, body)) {
        return;
      }
      if (handleViewerRuntimeFileMessage(source, body, event.source)) {
        return;
      }
      if (handleDockingPoseMessage(source, body)) {
        return;
      }
      markViewerFirstRenderMessage(source, body);
      if (source === "burrete-viewer" && handleViewerFileMessage(body)) {
        return;
      }
      if (handleXyzrenderSheetMessage(source, body, event.source)) {
        return;
      }
      if (source === "burrete-grid") {
        if (handleGridControlMessage(body)) {
          return;
        }
        if (handleGridFileMessage(body, event.source)) {
          return;
        }
        if (handleGridRuntimeMessage(body, event.source)) {
          return;
        }
      }
      if (handleViewerRuntimeMessage(body)) {
        return;
      }
      if (await handleSdfViewerMessage(body)) {
        return;
      }
      if (handleGridConformerMessage(body, event.source)) {
        return;
      }
      if (handleViewerConformerMessage(body, event.source)) {
        return;
      }
      if (handleMolstarContextMessage(body)) {
        return;
      }
      if (handleKetcherViewerMessage(body)) {
        return;
      }
      if (handleRendererMessage(body)) {
        return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    handleDockingPoseMessage,
    handleGridConformerMessage,
    handleGridControlMessage,
    handleGridFileMessage,
    handleGridRuntimeMessage,
    handleKetcherViewerMessage,
    handleMolstarContextMessage,
    handleRendererMessage,
    handleSdfViewerMessage,
    handleViewerConformerMessage,
    handleViewerFileMessage,
    handleViewerHostMessage,
    handleViewerRuntimeFileMessage,
    handleViewerRuntimeMessage,
    handleViewerStateMessage,
    handleXyzrenderSheetMessage,
    isKnownViewerMessageSource,
    markViewerFirstRenderMessage,
  ]);
}

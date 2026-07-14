import type { KnownViewerMessageSource } from "./viewer-bridge";

export type ViewerBridgeMessageSource = "burrete-viewer" | "burrete-grid" | "burrete-agent-viewer";
export type ViewerBridgeMessageBody = (Record<string, unknown> & { documentId?: string }) | null | undefined;

export type ViewerBridgeMessage = {
  source: ViewerBridgeMessageSource;
  body: ViewerBridgeMessageBody;
  eventSource: MessageEventSource | null;
};

export type SourceMessageHandler = (
  source: ViewerBridgeMessageSource,
  body: ViewerBridgeMessageBody,
) => boolean;
export type SourceEventMessageHandler = (
  source: ViewerBridgeMessageSource,
  body: ViewerBridgeMessageBody,
  eventSource: MessageEventSource | null,
) => boolean;
export type BodyMessageHandler = (body: ViewerBridgeMessageBody) => boolean;
export type BodyEventMessageHandler = (
  body: ViewerBridgeMessageBody,
  eventSource: MessageEventSource | null,
) => boolean;
export type AsyncBodyMessageHandler = (body: ViewerBridgeMessageBody) => Promise<boolean>;
export type FirstRenderMessageHandler = (
  source: ViewerBridgeMessageSource,
  body: ViewerBridgeMessageBody,
) => void;

export type ViewerBridgeMessageHandlers = {
  handleDockingPoseMessage: SourceMessageHandler;
  handleGridConformerMessage: BodyEventMessageHandler;
  handleGridControlMessage: BodyMessageHandler;
  handleGridFileMessage: BodyEventMessageHandler;
  handleGridRuntimeMessage: BodyEventMessageHandler;
  handleKetcherViewerMessage: BodyMessageHandler;
  handleMolstarContextMessage: BodyMessageHandler;
  handlePubChemSearchMessage: BodyMessageHandler;
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

type ViewerBridgeEnvelope = {
  source?: unknown;
  body?: unknown;
};

export function viewerBridgeSource(value: unknown): ViewerBridgeMessageSource | null {
  return value === "burrete-viewer" || value === "burrete-grid" || value === "burrete-agent-viewer"
    ? value
    : null;
}

export function viewerBridgeBodyDocumentId(body: ViewerBridgeMessageBody): string | undefined {
  return body && typeof body === "object" && typeof body.documentId === "string"
    ? body.documentId
    : undefined;
}

export function parseViewerBridgeMessage(event: Pick<MessageEvent, "data" | "source">): ViewerBridgeMessage | null {
  const data = event.data && typeof event.data === "object"
    ? event.data as ViewerBridgeEnvelope
    : null;
  const source = viewerBridgeSource(data?.source);
  if (!source) return null;
  return {
    source,
    body: data?.body as ViewerBridgeMessageBody,
    eventSource: event.source,
  };
}

export async function dispatchViewerBridgeMessage(
  message: ViewerBridgeMessage,
  handlers: ViewerBridgeMessageHandlers,
): Promise<boolean> {
  const { body, eventSource, source } = message;
  if (!handlers.isKnownViewerMessageSource(eventSource, viewerBridgeBodyDocumentId(body))) {
    return false;
  }
  if (handlers.handleViewerHostMessage(source, body)) {
    return true;
  }
  if (handlers.handleViewerStateMessage(source, body)) {
    return true;
  }
  if (handlers.handleViewerRuntimeFileMessage(source, body, eventSource)) {
    return true;
  }
  if (handlers.handleDockingPoseMessage(source, body)) {
    return true;
  }
  handlers.markViewerFirstRenderMessage(source, body);
  if (source === "burrete-viewer" && handlers.handleViewerFileMessage(body)) {
    return true;
  }
  if (handlers.handleXyzrenderSheetMessage(source, body, eventSource)) {
    return true;
  }
  if (source === "burrete-grid") {
    if (handlers.handleGridControlMessage(body)) {
      return true;
    }
    if (handlers.handleGridFileMessage(body, eventSource)) {
      return true;
    }
    if (handlers.handleGridRuntimeMessage(body, eventSource)) {
      return true;
    }
  }
  if (handlers.handleViewerRuntimeMessage(body)) {
    return true;
  }
  if (await handlers.handleSdfViewerMessage(body)) {
    return true;
  }
  if (handlers.handleGridConformerMessage(body, eventSource)) {
    return true;
  }
  if (handlers.handleViewerConformerMessage(body, eventSource)) {
    return true;
  }
  if (handlers.handleMolstarContextMessage(body)) {
    return true;
  }
  if (handlers.handlePubChemSearchMessage(body)) {
    return true;
  }
  if (handlers.handleKetcherViewerMessage(body)) {
    return true;
  }
  if (handlers.handleRendererMessage(body)) {
    return true;
  }
  return false;
}

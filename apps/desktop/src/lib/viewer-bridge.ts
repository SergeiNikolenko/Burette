export type ActiveViewerIframeForDocument = (documentId: string, renderer?: string) => HTMLIFrameElement | null;
export type KnownViewerMessageSource = (source: MessageEventSource | null, documentId?: string) => boolean;
export type PostMessageToViewerSource = (source: MessageEventSource | null, payload: unknown) => void;

export function isKnownViewerMessageSource(source: MessageEventSource | null, documentId?: string) {
  if (!source) return false;
  return Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")).some(
    (iframe) => (!documentId || iframe.dataset.documentId === documentId) && iframe.contentWindow === source,
  );
}

export function isReadOnlyViewerMessageSource(source: MessageEventSource | null) {
  if (!source) return false;
  return Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-read-only=\"true\"]")).some(
    (iframe) => iframe.contentWindow === source,
  );
}

export function postMessageToViewerSource(source: MessageEventSource | null, payload: unknown) {
  if (source && typeof source === "object" && "postMessage" in source && typeof source.postMessage === "function") {
    (source as Window).postMessage(payload, "*");
    return;
  }
  const documentId = payload && typeof payload === "object"
    && "body" in payload
    && payload.body
    && typeof payload.body === "object"
    && "documentId" in payload.body
    && typeof payload.body.documentId === "string"
    ? payload.body.documentId
    : null;
  if (!documentId) return;
  const selector = `.viewer-iframe[data-document-id="${CSS.escape(documentId)}"]`;
  const iframe = document.querySelector<HTMLIFrameElement>(`${selector}:not([data-read-only="true"])`)
    ?? document.querySelector<HTMLIFrameElement>(selector);
  iframe?.contentWindow?.postMessage(payload, "*");
}

export function activeViewerIframeForDocument(documentId: string, renderer?: string) {
  const escapedId = CSS.escape(documentId);
  const rendererSelector = renderer ? `[data-renderer="${CSS.escape(renderer)}"]` : "";
  return document.querySelector<HTMLIFrameElement>(
    `.page-surface[data-active="true"] .viewer-iframe[data-document-id="${escapedId}"]${rendererSelector}:not([data-read-only="true"])`,
  ) ?? document.querySelector<HTMLIFrameElement>(
    `.viewer-iframe[data-document-id="${escapedId}"]${rendererSelector}:not([data-read-only="true"])`,
  ) ?? document.querySelector<HTMLIFrameElement>(
    `.page-surface[data-active="true"] .viewer-iframe[data-document-id="${escapedId}"]${rendererSelector}`,
  ) ?? document.querySelector<HTMLIFrameElement>(
    `.viewer-iframe[data-document-id="${escapedId}"]${rendererSelector}`,
  );
}

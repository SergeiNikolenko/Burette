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

// The one place that names the grid host channel. Commands normally act on the
// grid's selection; `rowIndex` lets a caller that already knows its row - the
// molecule preview card - name it instead.
export function postGridCommand(documentId: string, command: string, rowIndex?: number) {
  activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
    source: "burette-grid-host",
    body: { type: "gridMenuCommand", command, ...(rowIndex === undefined ? {} : { rowIndex }) },
  }, "*");
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

// Request/ack transport for workspace commands that must finish before the next
// operation. Both the frame and request id are checked, including hidden tabs.
export async function requestViewerAction(documentId: string, action: Record<string, unknown>, timeoutMs = 60000) {
  const frame = activeViewerIframeForDocument(documentId, "molstar");
  if (!frame?.contentWindow || frame.dataset.readOnly === "true") throw new Error("Open the scene and wait for it to load.");
  const source = frame.contentWindow;
  const id = `workspace-${crypto.randomUUID()}`;
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const finish = () => { window.clearTimeout(timer); window.removeEventListener("message", receive); };
    const receive = (event: MessageEvent) => {
      const body = event.data?.source === "burette-agent-viewer" ? event.data.body : null;
      if (event.source !== source || body?.type !== "agent-action-result" || body.id !== id) return;
      finish();
      if (body.result?.ok) resolve(body.result.result ?? {});
      else reject(new Error(body.result?.error?.message ?? body.result?.message ?? "The viewer could not complete this action."));
    };
    const timer = window.setTimeout(() => { finish(); reject(new Error("The scene did not respond. Check it before retrying.")); }, timeoutMs);
    window.addEventListener("message", receive);
    source.postMessage({ source: "burette-agent-host", body: { type: "agent-action", id, action } }, "*");
  });
}

// Setting the grid view is idempotent. Retry during iframe startup until that
// specific grid acknowledges the command; opening a file can mount it later.
export function requestGridView(documentId: string, mode: "table" | "cards") {
  const requestId = `grid-view-${crypto.randomUUID()}`;
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { window.clearInterval(interval); window.clearTimeout(timeout); window.removeEventListener('message', receive); };
    const receive = (event: MessageEvent) => {
      const frame = activeViewerIframeForDocument(documentId, "grid2d");
      const body = event.data?.body;
      if (event.source !== frame?.contentWindow || event.data?.source !== 'burette-grid' || body?.type !== 'gridMenuCommandResult' || body.requestId !== requestId) return;
      cleanup(); resolve();
    };
    const send = () => activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
      source: 'burette-grid-host', body: { type: 'gridMenuCommand', command: `view.grid-${mode}`, requestId },
    }, '*');
    const interval = window.setInterval(send, 250);
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('The table did not finish loading.')); }, 15000);
    window.addEventListener('message', receive); send();
  });
}

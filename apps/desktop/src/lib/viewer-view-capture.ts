export type CapturedViewerView = { viewState: Record<string, unknown> & { camera?: unknown }; viewport: { width: number; height: number } | null };

/**
 * Asks a Mol* viewer frame for its current camera. Resolves null when the frame
 * does not answer within `timeoutMs`, so callers can fall back without waiting.
 */
export function captureViewerView(frame: HTMLIFrameElement, documentId: string, timeoutMs = 1000): Promise<CapturedViewerView | null> {
  const source = frame.contentWindow;
  if (!source) return Promise.resolve(null);
  const requestId = `view-capture-${crypto.randomUUID()}`;
  return new Promise((resolve) => {
    const finish = (value: CapturedViewerView | null) => { clearTimeout(timer); window.removeEventListener("message", receive); resolve(value); };
    const receive = (event: MessageEvent) => {
      const body = event.data?.source === "burette-viewer" ? event.data.body : null;
      if (event.source !== source || body?.type !== "rendererViewStateCaptured" || body.requestId !== requestId || body.documentId !== documentId) return;
      const viewState = body.viewState && typeof body.viewState === "object" && !Array.isArray(body.viewState) ? body.viewState : null;
      const viewport = body.viewport && [body.viewport.width, body.viewport.height].every((value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 32768)
        ? { width: body.viewport.width as number, height: body.viewport.height as number } : null;
      finish(viewState ? { viewState, viewport } : null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", receive);
    try { source.postMessage({ source: "burette-host", body: { type: "captureRendererViewState", requestId } }, "*"); }
    catch { finish(null); }
  });
}

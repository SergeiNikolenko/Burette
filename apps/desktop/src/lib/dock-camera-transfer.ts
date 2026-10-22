import { activeViewerIframeForDocument } from "./viewer-bridge";
import type { DockArea } from "./dock";
import type { ViewerDocument } from "../types";

type Viewport = { width: number; height: number };
type DockView = { viewState: string; sourceViewport?: Viewport };
// Transient pane views must not overwrite the source tab's authored camera.
// Retain them across Files remounts, but never write them into the scene file.
const views = new Map<string, { workspaceId: string; view: DockView }>();
let workspaces = new Set<string>();
const key = (workspaceId: string, area: DockArea, id: string) => JSON.stringify([workspaceId, area, id]);

export function retainDockCameraWorkspaces(ids: string[]) {
  workspaces = new Set(ids);
  for (const [pane, entry] of views) if (!workspaces.has(entry.workspaceId)) views.delete(pane);
}

function remember(pane: string, workspaceId: string, view: DockView) {
  views.delete(pane);
  views.set(pane, { workspaceId, view });
  if (views.size > 64) views.delete(views.keys().next().value!);
}

function paneKey(source: MessageEventSource | null, id: string) {
  const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>('.viewer-iframe[data-read-only="true"]'))
    .find(frame => frame.contentWindow === source && frame.dataset.documentId === id);
  const panel = frame?.closest<HTMLElement>(".dock-panel");
  const area = panel?.dataset.area, workspaceId = panel?.dataset.workspaceId;
  return workspaceId && (area === "right" || area === "bottom")
    ? { pane: key(workspaceId, area, id), workspaceId } : null;
}

function boundedView(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const text = JSON.stringify(value);
    return text.length <= 8192 ? text : null;
  } catch { return null; }
}

export function dockCameraRestore(source: MessageEventSource | null, id: string) {
  const pane = paneKey(source, id);
  return pane && workspaces.has(pane.workspaceId) ? views.get(pane.pane)?.view : undefined;
}

export function rememberDockCamera(source: MessageEventSource | null, id: string, value: unknown) {
  const pane = paneKey(source, id);
  if (!pane) return false;
  // Hidden content can outlive its closed workspace; swallow its late checkpoint.
  if (!workspaces.has(pane.workspaceId)) return true;
  const viewState = boundedView(value);
  if (viewState) remember(pane.pane, pane.workspaceId, { viewState });
  return true;
}

export async function prepareDockCameraTransfer(area: DockArea, sourceDocument: ViewerDocument, workspaceId: string | null) {
  if (!workspaceId || !workspaces.has(workspaceId)) return;
  const pane = key(workspaceId, area, sourceDocument.id);
  if (sourceDocument.renderer !== "molstar" || views.has(pane)) return;
  // Reopening an already mounted Files view must not replace its camera.
  if (Array.from(document.querySelectorAll<HTMLIFrameElement>('.viewer-iframe[data-read-only="true"]'))
    .some(frame => paneKey(frame.contentWindow, sourceDocument.id)?.pane === pane)) return;
  const frame = activeViewerIframeForDocument(sourceDocument.id, "molstar");
  const source = frame?.contentWindow;
  if (!source || frame.dataset.readOnly === "true") return;
  const requestId = `dock-camera-${crypto.randomUUID()}`;
  await new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); window.removeEventListener("message", receive); resolve(); };
    const receive = (event: MessageEvent) => {
      const body = event.data?.source === "burette-viewer" ? event.data.body : null;
      if (event.source !== source || body?.type !== "rendererViewStateCaptured"
        || body.requestId !== requestId || body.documentId !== sourceDocument.id) return;
      const viewport = body.viewport;
      const viewState = boundedView(body.viewState);
      if (workspaces.has(workspaceId) && frame.isConnected && viewState && body.viewState?.camera && viewport
        && [viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0 && value <= 32768)) {
        remember(pane, workspaceId, { viewState, sourceViewport: { width: viewport.width, height: viewport.height } });
      }
      finish();
    };
    const timer = setTimeout(finish, 1000);
    window.addEventListener("message", receive);
    try { source.postMessage({ source: "burette-host", body: { type: "captureRendererViewState", requestId } }, "*"); }
    catch { finish(); }
  });
}

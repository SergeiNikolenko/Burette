import type { ShellActions } from "../components/types";
import type { ViewerDocument } from "../types";
import { readGeometryBinding, type GeometryBinding } from "./geometry-binding";
import { captureLogicalSourceOwner } from "./science-session/state";
import { captureViewerActionTarget } from "./viewer-bridge";

/** Initial loading may precede the viewer's receiver/model. Only an unpublished model may retry. */
export function observeGeometryBinding(document: ViewerDocument, send: ShellActions["runStructureViewerAction"],
  sourceIsCurrent: () => boolean, receive: (binding: GeometryBinding) => void, reject: (error: unknown) => void) {
  const ownsSource = captureLogicalSourceOwner(document.id);
  const target = captureViewerActionTarget(document.id, () => ownsSource() && sourceIsCurrent());
  let disposed = false, published = false, revision = 0, pending: AbortController | null = null;
  const start = () => {
    if (disposed || published) return;
    const current = ++revision;
    pending?.abort();
    const controller = new AbortController(); pending = controller;
    void Promise.resolve().then(() => {
      if (!target) throw new Error("Open the scene and wait for it to load.");
      if (!target.isCurrent()) throw Object.assign(new Error("The structure changed while Geometry was being read."), { name: "AbortError" });
      // Neither temporary read cancellation nor observer cleanup revokes a published rollback target.
      return readGeometryBinding(document, send, target.isCurrent, controller.signal);
    }).then(binding => {
      if (disposed || published || revision !== current || !target?.isCurrent()) return;
      receive(binding);
      published = true;
      window.removeEventListener("message", ready);
    }).catch(error => {
      if (!disposed && revision === current && !controller.signal.aborted) reject(error);
    }).finally(() => { if (pending === controller) pending = null; });
  };
  const ready = (event: MessageEvent) => {
    if (disposed || published || !target?.isCurrent() || event.source !== target.source) return;
    const data = event.data as { source?: unknown; body?: { type?: unknown; renderer?: unknown; documentId?: unknown } } | null;
    const body = data?.body;
    if (data?.source !== "burette-viewer" || (body?.type !== "ready" && body?.type !== "agentReady")
      || (body.renderer !== undefined && body.renderer !== "molstar")
      || (body.documentId !== undefined && body.documentId !== document.id)) return;
    start();
  };
  window.addEventListener("message", ready);
  start();
  return () => {
    disposed = true; revision++; pending?.abort();
    window.removeEventListener("message", ready);
  };
}

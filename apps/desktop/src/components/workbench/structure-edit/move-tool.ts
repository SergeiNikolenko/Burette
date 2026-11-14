import { useEffect, useRef } from "react";
import { setAtomDragMode, subscribeAtomDrag, type AtomDragEvent } from "../../../lib/atom-drag";
import type { GeometryBinding } from "../../../lib/geometry-binding";
import { activeViewerIframeForDocument } from "../../../lib/viewer-bridge";
import type { ViewerDocument } from "../../../types";
import type { ShellActions } from "../../types";

/**
 * Avogadro's Manipulate and Bond-Centric tools while `binding` is set: dragging an
 * atom moves it (or the selection it belongs to), dragging a bond turns its smaller
 * side, and ⌥ rotates the selection or stretches the bond. The viewer moves the
 * scene under the pointer; each released drag reaches `onMoved` once with the final
 * positions of the moved atoms. A draft write reloads the scene into a second frame
 * that becomes visible only after it renders, so a binding read before then belongs to
 * the old frame: while `active`, `onStale` asks for a new binding whenever the document's
 * active frame changes. That also recovers a read the old frame failed, as it does after an
 * edit that changed the atom count.
 */
const FRAME_CHECK_MS = 400;

export function useAtomMove(document: ViewerDocument, binding: GeometryBinding | null, send: ShellActions["runStructureViewerAction"],
  onMoved: (event: AtomDragEvent) => void, onError: (message: string) => void, onStale: () => void, active: boolean) {
  const handlers = useRef({ onMoved, onError, onStale, send });
  handlers.current = { onMoved, onError, onStale, send };
  useEffect(() => {
    if (!binding) return undefined;
    const controller = new AbortController();
    const unsubscribe = subscribeAtomDrag(document, binding, (event) => { if (event.phase === "end") handlers.current.onMoved(event); });
    void setAtomDragMode(document, binding, true, handlers.current.send, { signal: controller.signal, manipulate: true })
      .catch((caught) => { if (!controller.signal.aborted) handlers.current.onError(caught instanceof Error ? caught.message : String(caught)); });
    return () => {
      controller.abort(); unsubscribe();
      void setAtomDragMode(document, binding, false, handlers.current.send).catch(() => {});
    };
  }, [binding, document.id]);
  useEffect(() => {
    if (!active) return undefined;
    const frame = () => activeViewerIframeForDocument(document.id)?.contentWindow ?? null;
    let seen = frame();
    const check = window.setInterval(() => {
      const current = frame();
      if (current !== seen) { seen = current; handlers.current.onStale(); }
    }, FRAME_CHECK_MS);
    return () => window.clearInterval(check);
  }, [active, document.id]);
}

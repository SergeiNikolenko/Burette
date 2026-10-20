import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewerDocument } from "../../types";

// Presentation edits (representations, measurements, colours) have undo state
// even when coordinates are clean. A source-file reload cannot restore them.
export function useSceneEditProtection(documents: readonly ViewerDocument[]) {
  const editedFrames = useRef(new Map<HTMLIFrameElement, string>());
  const [protectedIds, setProtectedIds] = useState<ReadonlySet<string>>(new Set());
  const [checkpointFailures, setCheckpointFailures] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const documentIds = new Set(documents.map(document => document.id));
    const prune = (previous: ReadonlySet<string>) => {
      const retained = [...previous].filter(id => documentIds.has(id));
      return retained.length === previous.size ? previous : new Set(retained);
    };
    const frames = editedFrames.current;
    const publish = () => {
      const ids = new Set(frames.values());
      setProtectedIds(previous => previous.size === ids.size && [...ids].every(id => previous.has(id)) ? previous : ids);
    };
    for (const [frame, id] of frames) if (!frame.isConnected || !documentIds.has(id)) frames.delete(frame);
    publish();
    setCheckpointFailures(prune);
    const changed = (event: Event) => {
      const body = (event as CustomEvent<Record<string, unknown>>).detail;
      if (typeof body?.documentId !== "string" || !documentIds.has(body.documentId)) return;
      if (typeof body.canUndo !== "boolean" || typeof body.canRedo !== "boolean") return;
      const id = body.documentId;
      if (!body.frameSource) return;
      const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]"))
        .find(candidate => candidate.dataset.documentId === id && candidate.contentWindow === body.frameSource);
      if (!frame) return;
      const protect = body.canUndo === true || body.canRedo === true;
      if (protect) frames.set(frame, id);
      else frames.delete(frame);
      publish();
    };
    const checkpoint = (event: Event) => {
      const body = (event as CustomEvent<Record<string, unknown>>).detail;
      if (typeof body?.documentId !== "string" || !documentIds.has(body.documentId) || typeof body.persisted !== "boolean") return;
      const id = body.documentId;
      setCheckpointFailures(previous => {
        if (previous.has(id) === !body.persisted) return previous;
        const next = new Set(previous);
        if (!body.persisted) next.add(id);
        else next.delete(id);
        return next;
      });
    };
    window.addEventListener("burette:molstar-edit-history-changed", changed);
    window.addEventListener("burette:renderer-view-checkpoint", checkpoint);
    // A document can own several live history/pane copies. Clean startup and
    // resets clear only that iframe's edits; closing it releases its own owner.
    // Check connectivity after the mutation batch so DOM moves retain ownership.
    const observer = new window.MutationObserver(records => {
      let removed = false;
      for (const record of records) for (const node of record.removedNodes) {
        if (node.nodeType !== 1) continue;
        const removedFrames = node.nodeName === "IFRAME" ? [node as HTMLIFrameElement]
          : (node as Element).querySelectorAll<HTMLIFrameElement>("iframe");
        for (const frame of removedFrames) {
          if (!frame.isConnected && frames.delete(frame)) removed = true;
        }
      }
      if (removed) publish();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("burette:molstar-edit-history-changed", changed);
      window.removeEventListener("burette:renderer-view-checkpoint", checkpoint);
    };
  }, [documents]);
  return useMemo(() => new Set([...protectedIds, ...checkpointFailures]), [protectedIds, checkpointFailures]);
}

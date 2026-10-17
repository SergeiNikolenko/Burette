import { useEffect, useMemo, useState } from "react";
import type { ViewerDocument } from "../../types";

// Presentation edits (representations, measurements, colours) have undo state
// even when coordinates are clean. A source-file reload cannot restore them.
export function useSceneEditProtection(documents: readonly ViewerDocument[]) {
  const [protectedIds, setProtectedIds] = useState<ReadonlySet<string>>(new Set());
  const [checkpointFailures, setCheckpointFailures] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const documentIds = new Set(documents.map(document => document.id));
    const prune = (previous: ReadonlySet<string>) => {
      const retained = [...previous].filter(id => documentIds.has(id));
      return retained.length === previous.size ? previous : new Set(retained);
    };
    setProtectedIds(prune);
    setCheckpointFailures(prune);
    const changed = (event: Event) => {
      const body = (event as CustomEvent<Record<string, unknown>>).detail;
      if (typeof body?.documentId !== "string" || !documentIds.has(body.documentId)) return;
      if (typeof body.canUndo !== "boolean" || typeof body.canRedo !== "boolean") return;
      const id = body.documentId;
      const protect = body.canUndo === true || body.canRedo === true;
      setProtectedIds(previous => {
        if (previous.has(id) === protect) return previous;
        const next = new Set(previous);
        if (protect) next.add(id);
        else next.delete(id);
        return next;
      });
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
    return () => {
      window.removeEventListener("burette:molstar-edit-history-changed", changed);
      window.removeEventListener("burette:renderer-view-checkpoint", checkpoint);
    };
  }, [documents]);
  return useMemo(() => new Set([...protectedIds, ...checkpointFailures]), [protectedIds, checkpointFailures]);
}

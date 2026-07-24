import { useCallback, useMemo, useRef, useState } from "react";
import type { GridFilterModel } from "../components/types";
import type { ViewerDocument } from "../types";

type PostMessageToViewerSource = (
  source: MessageEventSource | null,
  message: { source: string; body: Record<string, unknown> },
) => void;

// The filter model lives in the grid runtime, so the panel that draws it can
// only ever hold a copy. Keep the copy per document, along with the frame that
// sent it, which is the only handle we have for sending commands back.
export function useAppGridFilterModel(
  activeDocument: ViewerDocument | null,
  documents: ViewerDocument[],
  postMessageToViewerSource: PostMessageToViewerSource,
) {
  const [models, setModels] = useState<Record<string, GridFilterModel>>({});
  const sourcesRef = useRef<Record<string, MessageEventSource | null>>({});

  const updateGridFilterModel = useCallback((
    documentId: string,
    model: GridFilterModel,
    source: MessageEventSource | null,
  ) => {
    if (!documentId) return;
    sourcesRef.current[documentId] = source;
    setModels((previous) => {
      const openIds = new Set(documents.map((entry) => entry.id));
      openIds.add(documentId);
      const next: Record<string, GridFilterModel> = { [documentId]: model };
      for (const [id, value] of Object.entries(previous)) {
        if (id !== documentId && openIds.has(id)) next[id] = value;
      }
      return next;
    });
  }, [documents]);

  const send = useCallback((body: Record<string, unknown>) => {
    const documentId = activeDocument?.id;
    if (!documentId) return;
    postMessageToViewerSource(sourcesRef.current[documentId] ?? null, {
      source: "burrete-grid-host",
      body,
    });
  }, [activeDocument, postMessageToViewerSource]);

  const setGridColumnFilter = useCallback((columnId: string, part: "min" | "max" | "text", value: string) => {
    send({ type: "gridSetColumnFilter", columnId, part, value });
  }, [send]);

  const clearGridColumnFilters = useCallback((columnId?: string) => {
    send({ type: "gridClearColumnFilters", ...(columnId ? { columnId } : {}) });
  }, [send]);

  const activeGridFilterModel = useMemo(() => (
    activeDocument?.renderer === "grid2d" ? models[activeDocument.id] ?? null : null
  ), [activeDocument, models]);

  return { activeGridFilterModel, updateGridFilterModel, setGridColumnFilter, clearGridColumnFilters };
}

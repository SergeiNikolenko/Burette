import { useCallback, useEffect } from "react";
import type { ViewerDocument } from "../types";
import { chemicalSpaceSourceMatches } from "../lib/chemical-space-documents";
import { activeViewerIframeForDocument } from "../lib/viewer-bridge";
import { isViewerFrameVisible } from "../lib/viewer-frame-visibility";

export function useChemicalSpaceViewerSelection(
  collection: ViewerDocument | null,
  viewer: ViewerDocument | null,
  setSelected: (ids: Set<number>) => void,
) {
  const target = collection && viewer?.renderer === "molstar"
    && chemicalSpaceSourceMatches(viewer, collection) ? viewer : null;

  useEffect(() => {
    if (!collection || !target) return;
    setSelected(new Set());
    const frame = activeViewerIframeForDocument(target.id, "molstar");
    const request = () => {
      const current = activeViewerIframeForDocument(target.id, "molstar");
      if (!current || current.dataset.readOnly === "true" || !isViewerFrameVisible(current)) return;
      current.contentWindow?.postMessage({
        source: "burette-host",
        body: { type: "chemicalSpaceRequestSelection", documentId: target.id },
      }, "*");
    };
    const receive = (event: MessageEvent) => {
      // Retained dock/history frames can outlive their visible ownership.
      const current = activeViewerIframeForDocument(target.id, "molstar");
      if (!current || current.dataset.readOnly === "true" || !isViewerFrameVisible(current)) return;
      const body = event.data?.body;
      if (event.source !== current.contentWindow || event.data?.source !== "burette-viewer"
        || body?.documentId !== target.id) return;
      if (body.type === "ready" || body.type === "agentReady") request();
      if (body.type !== "chemicalSpaceMoleculeChanged") return;
      const index = body.sourceRecordId;
      if (!Number.isSafeInteger(index) || index < 0) return;
      const sourceId = target.moleculeSource
        ? target.moleculeSource.sourceRecordIds[index]
        : body.sourcePath === collection.path ? index : undefined;
      // A multi-file scene may now show a molecule from another collection.
      setSelected(new Set(sourceId === undefined ? [] : [sourceId]));
    };
    window.addEventListener("message", receive);
    frame?.addEventListener("load", request);
    request();
    return () => {
      window.removeEventListener("message", receive);
      frame?.removeEventListener("load", request);
    };
  }, [collection, target, setSelected]);

  return useCallback((sourceRecordId: number) => {
    if (!collection || !Number.isSafeInteger(sourceRecordId) || sourceRecordId < 0) return;
    const mappedIndex = target?.moleculeSource?.sourceRecordIds.indexOf(sourceRecordId);
    const frame = target && activeViewerIframeForDocument(target.id, "molstar");
    if (frame && frame.dataset.readOnly !== "true" && isViewerFrameVisible(frame) && mappedIndex !== -1) {
      frame.contentWindow?.postMessage({
        source: "burette-host",
        body: {
          type: "chemicalSpaceFocusMolecule", documentId: target.id,
          sourcePath: target.moleculeSource ? target.dockingRequest?.ligandPaths[0] ?? target.path : collection.path,
          sourceRecordId: mappedIndex ?? sourceRecordId,
        },
      }, "*");
    } else {
      activeViewerIframeForDocument(collection.id, "grid2d")?.contentWindow?.postMessage({
        source: "burette-grid-host",
        body: { type: "chemicalSpaceOpenMolecule", documentId: collection.id, sourceRecordId,
          navigationDocumentId: viewer?.id ?? collection.id },
      }, "*");
    }
  }, [collection, target, viewer?.id]);
}

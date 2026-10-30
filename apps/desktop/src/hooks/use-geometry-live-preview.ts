import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { ShellActions } from "../components/types";
import { claimGeometryPreview, releaseGeometryPreview } from "../lib/geometry-preview-owners";
import type { GeometryBinding } from "../lib/geometry-binding";
import type { ViewerDocument } from "../types";

// One model lifetime owns its baseline, transport and queued acknowledgements.
type Lane = {
  document: ViewerDocument; binding: GeometryBinding | null; send: ShellActions["runStructureViewerAction"];
  baseline: string | null; pending: string | null; frame: number | null; queue: Promise<unknown>; revision: number; active: boolean;
};

/** The model's binding is read before edits are computed; a queue never acquires a new owner. */
export function useGeometryLivePreview(document: ViewerDocument, binding: GeometryBinding | null,
  send: ShellActions["runStructureViewerAction"], onError: (error: unknown) => void) {
  const sender = useRef(send), errorHandler = useRef(onError), currentDocument = useRef(document);
  useLayoutEffect(() => { sender.current = send; errorHandler.current = onError; currentDocument.current = document; });
  const scope = useMemo(() => ({ binding, documentId: document.id, path: document.path,
    renderer: document.renderer, runtimePath: document.runtimePath, openClaimId: document.openClaimId }),
    [document.id, document.path, document.renderer, document.runtimePath, document.openClaimId, binding]);
  const lanes = useRef(new WeakMap<object, Lane>());
  const laneFor = useCallback(() => {
    let lane = lanes.current.get(scope);
    if (!lane) {
      lane = { document: { ...currentDocument.current }, binding: scope.binding, send: sender.current,
        baseline: null, pending: null, frame: null, queue: Promise.resolve(), revision: 0, active: false };
      lanes.current.set(scope, lane);
    }
    return lane;
  }, [scope]);
  const reportError = useCallback((error: unknown) => { if (laneFor().active) errorHandler.current(error); }, [laneFor]);
  const claim = useCallback(() => {
    const lane = laneFor();
    if (!lane.active || !lane.binding) return false;
    if (!claimGeometryPreview(lane.document.id, lane, lane.binding.target.isCurrent)) return false;
    if (lane.baseline === null) lane.send = sender.current;
    return true;
  }, [laneFor]);
  const release = useCallback(() => {
    const lane = laneFor(), settled = lane.queue;
    void settled.catch(() => {}).then(() => {
      if (lane.queue === settled && lane.baseline === null) releaseGeometryPreview(lane.document.id, lane);
    });
  }, [laneFor]);
  const cancelFrame = useCallback(() => {
    const lane = laneFor();
    if (lane.frame !== null) cancelAnimationFrame(lane.frame);
    lane.frame = null;
    lane.pending = null;
  }, [laneFor]);
  const sendText = useCallback((text: string, previewRevision?: number) => {
    const lane = laneFor(), dispatch = lane.send, captured = lane.binding;
    const result = lane.queue.catch(() => {}).then(() => {
      if (previewRevision !== undefined && previewRevision !== lane.revision) return;
      if (!captured) throw new Error("Open the scene and wait for it to load.");
      return dispatch(lane.document, { type: "update_geometry", label: "Geometry", text,
        lease: captured.lease, notify: false }, { target: captured.target });
    });
    lane.queue = result;
    return result;
  }, [laneFor]);
  const cancel = useCallback(() => {
    const lane = laneFor();
    lane.revision++;
    cancelFrame();
    const baseline = lane.baseline;
    lane.baseline = null;
    if (baseline !== null) void sendText(baseline).catch(reportError);
    release();
  }, [laneFor, cancelFrame, sendText, release, reportError]);
  useLayoutEffect(() => {
    const lane = laneFor(); lane.active = true;
    return () => { lane.active = false; cancel(); };
  }, [laneFor, cancel]);
  const preview = useCallback((text: string, baseline: string) => {
    if (!claim()) return;
    const lane = laneFor();
    lane.revision++;
    if (lane.baseline === null) lane.baseline = baseline;
    lane.pending = text;
    if (lane.frame !== null) return;
    lane.frame = requestAnimationFrame(() => {
      lane.frame = null;
      const pending = lane.pending;
      lane.pending = null;
      if (pending !== null) void sendText(pending, lane.revision).catch(reportError);
    });
  }, [laneFor, claim, sendText, reportError]);
  const commit = useCallback(async (text: string, baseline: string) => {
    const lane = laneFor();
    if (!lane.active) throw new Error("Geometry edit cancelled.");
    if (!lane.binding) throw new Error("Open the scene and wait for it to load.");
    if (!claim()) throw new Error("Another panel is changing this structure.");
    cancelFrame();
    if (lane.baseline === null) lane.baseline = baseline;
    const committedRevision = ++lane.revision;
    await sendText(text);
    if (committedRevision !== lane.revision) throw new Error("Geometry edit cancelled.");
    lane.baseline = null;
    release();
  }, [laneFor, claim, cancelFrame, sendText, release]);
  // Topology replacements restore this model's transient geometry before reloading.
  const replace = useCallback(async <T,>(reload: () => Promise<T>) => {
    const lane = laneFor();
    if (!lane.active) throw new Error("Geometry edit cancelled.");
    if (!lane.binding) throw new Error("Open the scene and wait for it to load.");
    if (!claim()) throw new Error("Another panel is changing this structure.");
    const replacementRevision = ++lane.revision;
    cancelFrame();
    const baseline = lane.baseline;
    lane.baseline = null;
    // The retained lease is checked by an acknowledged apply even without a preview.
    // This also lets a current owner recover from an earlier failed operation.
    const restored = sendText(baseline ?? lane.binding.text);
    const result = restored.then(() => {
      if (!lane.active || replacementRevision !== lane.revision || !lane.binding?.target.isCurrent()) {
        throw new Error("Geometry edit cancelled.");
      }
      return reload();
    });
    lane.queue = result;
    return result.finally(release);
  }, [laneFor, claim, cancelFrame, sendText, release, reportError]);
  return { preview, commit, cancel, replace };
}

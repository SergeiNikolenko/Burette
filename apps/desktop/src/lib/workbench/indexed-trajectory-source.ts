import { useEffect, useState } from "react";
import type { ViewerDocument } from "../../types";
import { requestIndexedTrajectoryFrame, type IndexedTrajectoryFrame } from "../indexed-trajectory-frame";
import { useTrajectoryFrame } from "./source";

// Many surfaces ask whether Plots is available. Share their one small discovery
// request for this document and frame event; old event/document entries are weak.
const discoveries = new WeakMap<object, WeakMap<ViewerDocument, Map<boolean, Promise<Awaited<ReturnType<typeof requestIndexedTrajectoryFrame>>>>>>();
function discover(document: ViewerDocument, event: object, includeSummary: boolean) {
  let documents = discoveries.get(event);
  if (!documents) { documents = new WeakMap(); discoveries.set(event, documents); }
  let requests = documents.get(document);
  if (!requests) { requests = new Map(); documents.set(document, requests); }
  let pending = requests.get(includeSummary);
  if (!pending) { pending = requestIndexedTrajectoryFrame(document.id, { limit: 1, includeSummary }); requests.set(includeSummary, pending); }
  return pending;
}

/** Only the current displayed model may feed a plot or an export. */
export function useIndexedTrajectorySource(document: ViewerDocument | null, includeSummary = false) {
  const event = useTrajectoryFrame(document?.id ?? null);
  const [state, setState] = useState<{ document: ViewerDocument; event: object; includeSummary: boolean; frame: IndexedTrajectoryFrame | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!document || document.renderer !== "molstar" || !event) return;
    let current = true;
    void discover(document, event, includeSummary).then((result) => {
      if (!current) return;
      const frame = result.available && result.frameIndex === event.frameIndex && result.frameCount === event.frameCount ? result : null;
      setState({ document, event, includeSummary, frame, error: null });
    }, () => {
      if (current) setState({ document, event, includeSummary, frame: null, error: "Could not read this trajectory frame. Pause playback and select the frame again." });
    });
    return () => { current = false; };
  }, [document, event, includeSummary]);
  const current = state?.document === document && state.event === event && state.includeSummary === includeSummary ? state : null;
  // A seek invalidates values immediately, but not the document capability.
  // Removing the tab during its request would unmount and discard plot history.
  const available = Boolean(event && state?.document === document && (current ? current.frame : state.frame));
  return {
    available,
    frameIndex: event?.frameIndex ?? null,
    segmentStartFrame: event?.segmentStartFrame ?? 0,
    frame: current?.frame ?? null,
    error: current?.error ?? null,
    loading: Boolean(event && document?.renderer === "molstar" && !current),
  };
}

const MAX_EXPORT_BYTES = 16 * 1024 * 1024;
/** Pages are pinned to one model. A seek/reload rejects, never mixes two frames. */
export async function indexedFrameCsv(documentId: string, frame: IndexedTrajectoryFrame, signal: AbortSignal, progress: (count: number) => void) {
  const expected = { sourceId: frame.sourceId, modelId: frame.modelId, structureRef: frame.structureRef, frameIndex: frame.frameIndex, segmentIndex: frame.segmentIndex };
  const velocity = Boolean(frame.units.velocity), force = Boolean(frame.units.force);
  const lines = [`frame,atom,source_atom,element,x_A,y_A,z_A${velocity ? ",vx_A_ps,vy_A_ps,vz_A_ps" : ""}${force ? ",fx_kcal_mol_A,fy_kcal_mol_A,fz_kcal_mol_A" : ""}\n`];
  let bytes = lines[0].length;
  for (let offset = 0; offset < frame.total;) {
    signal.throwIfAborted();
    const page = await requestIndexedTrajectoryFrame(documentId, { offset, limit: 100, expected }, signal);
    if (!page.available || page.total !== frame.total || page.offset !== offset || !page.atoms.length) throw new Error("The trajectory changed. Select the frame and export again.");
    for (const atom of page.atoms) {
      const line = [frame.frameIndex + 1, atom.index + 1, atom.sourceAtomIndex + 1, atom.element ?? "", ...atom.position,
        ...(velocity ? atom.velocity ?? [] : []), ...(force ? atom.force ?? [] : [])].join(",") + "\n";
      bytes += new TextEncoder().encode(line).byteLength;
      if (bytes > MAX_EXPORT_BYTES) throw new Error("This frame exceeds the 16 MiB export limit.");
      lines.push(line);
    }
    offset += page.atoms.length;
    progress(offset);
  }
  signal.throwIfAborted();
  return lines.join("");
}

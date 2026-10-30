import type { ShellActions } from "../components/types";
import type { ViewerDocument } from "../types";
import { captureViewerActionTarget, type ViewerActionTarget } from "./viewer-bridge";
import { captureLogicalSourceOwner } from "./science-session/state";
import { waitForGeometryPreviewIdle } from "./geometry-preview-owners";

/** One runtime baseline and its owner, captured before any queued edits or computation. */
export type GeometryBinding = { lease: string; text: string; target: ViewerActionTarget };

export async function readGeometryBinding(document: ViewerDocument, send: ShellActions["runStructureViewerAction"],
  sourceIsCurrent: () => boolean, signal?: AbortSignal): Promise<GeometryBinding> {
  const ownsSource = captureLogicalSourceOwner(document.id);
  const target = captureViewerActionTarget(document.id, () => ownsSource() && sourceIsCurrent());
  const changed = () => Object.assign(new Error("The structure changed while Geometry was being read."), { name: "AbortError" });
  if (!target) throw new Error("Open the scene and wait for it to load.");
  // Only unread models may retry. A computed edit retains its original binding forever.
  for (;;) {
    signal?.throwIfAborted();
    if (!target.isCurrent()) throw changed();
    const read = await waitForGeometryPreviewIdle(document.id, signal);
    try {
      if (!target.isCurrent()) throw changed();
      if (!read.isCurrent()) continue;
      const result = await send(document, { type: "geometry_binding", label: "Geometry", notify: false }, { target, signal });
      signal?.throwIfAborted();
      if (!target.isCurrent()) throw changed();
      if (!read.isCurrent()) continue;
      if (!result || typeof result !== "object" || !("lease" in result) || typeof result.lease !== "string"
        || !result.lease || result.lease.length > 128 || !("text" in result) || typeof result.text !== "string"
        || result.text.length > 3 * 1024 * 1024) throw new Error("The scene did not return its current Geometry.");
      return { lease: result.lease, text: result.text, target };
    } finally { read.release(); }
  }
}

import type { ViewerDocument } from "../types";
import type { MolecularAtom } from "../lib/molecular-workbench/types";
import type { PolymerInput } from "../lib/workbench/polymer-task";
import { captureViewerActionTarget, requestViewerAction } from "../lib/viewer-bridge";
import { sha256Hex } from "../lib/source-editing/source-identity";

/** One source/model receipt; later gestures never silently bind a replacement scene. */
export async function capturePolymerPickOwner(document: ViewerDocument, input: PolymerInput & { atoms: MolecularAtom[] },
  sourceCurrent: () => boolean, signal: AbortSignal, onRetire: () => void) {
  const target = captureViewerActionTarget(document.id, sourceCurrent);
  if (!target) throw new Error("Open the source molecule and wait for it to load.");
  const lease = crypto.randomUUID(), controller = new AbortController();
  let retired = false, bindingSent = false;
  const isCurrent = () => !retired && !signal.aborted && target.isCurrent();
  const release = () => {
    if (retired) return;
    retired = true; controller.abort(); window.removeEventListener("message", receive); signal.removeEventListener("abort", release);
    if (bindingSent && target.isCurrent()) void requestViewerAction(document.id,
      { type: "polymer_source_release", lease, label: "Polymer", notify: false }, 15000, undefined, { target }).catch(() => {});
  };
  const receive = (event: MessageEvent) => {
    if (event.source !== target.source || event.data?.source !== "burette-viewer" || event.data.body?.type !== "polymer_source_retired"
      || event.data.body.lease !== lease) return;
    release(); onRetire();
  };
  window.addEventListener("message", receive); signal.addEventListener("abort", release, { once: true });
  try {
    signal.throwIfAborted();
    const sourceSha256 = await sha256Hex(input.text);
    if (!isCurrent()) throw new DOMException("Polymer source changed.", "AbortError");
    bindingSent = true;
    const bound = await requestViewerAction(document.id, { type: "polymer_source_binding", lease,
      expected: { format: input.format, sourceSha256, atoms: input.atoms }, label: "Polymer", notify: false }, 15000, controller.signal, { target });
    if (!isCurrent() || bound.lease !== lease || bound.atomCount !== input.atoms.length) throw new Error("The displayed molecule changed. Choose the atoms again.");
    const pick = async (pickSignal: AbortSignal) => {
      if (!isCurrent()) throw new DOMException("Polymer source changed.", "AbortError");
      const abort = AbortSignal.any([controller.signal, pickSignal]);
      const result = await requestViewerAction(document.id, { type: "polymer_pick_atom", lease, label: "Pick polymer atom", notify: false }, 120000, abort, { target });
      const index = result.sourceIndex;
      if (!isCurrent() || result.lease !== lease || typeof index !== "number" || !Number.isSafeInteger(index)
        || index < 0 || index >= input.atoms.length || result.element !== input.atoms[index].element) throw new Error("Pick an atom in the source molecule.");
      return index;
    };
    const validate = async () => {
      if (!isCurrent()) return false;
      const result = await requestViewerAction(document.id, { type: "polymer_source_validate", lease, label: "Polymer", notify: false }, 15000, controller.signal, { target });
      return isCurrent() && result.lease === lease;
    };
    return { isCurrent, pick, release, validate };
  } catch (error) { release(); throw error; }
}

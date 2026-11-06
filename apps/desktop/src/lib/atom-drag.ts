import type { ShellActions } from "../components/types";
import type { ViewerDocument } from "../types";
import type { GeometryBinding } from "./geometry-binding";

export type AtomDragPhase = "start" | "move" | "end" | "cancel";
/** One gesture step from the viewer; atoms are zero-based source indices, positions in Å. */
export type AtomDragEvent = {
  phase: AtomDragPhase;
  lease: string;
  atoms: number[];
  positions: [number, number, number][];
};

const phases: ReadonlySet<unknown> = new Set<AtomDragPhase>(["start", "move", "end", "cancel"]);
const MAX_DRAGGED_ATOMS = 100_000;

/**
 * Turns the viewer's drag mode on or off for the structure behind `binding`.
 * The viewer refuses to enable it once the lease no longer owns the scene.
 */
export async function setAtomDragMode(document: ViewerDocument, binding: GeometryBinding, enabled: boolean,
  send: ShellActions["runStructureViewerAction"], signal?: AbortSignal): Promise<void> {
  if (binding.target.documentId !== document.id) throw new Error("The Geometry binding belongs to another document.");
  await send(document, { type: "atom_drag", enabled, lease: binding.lease, label: "Atom drag", notify: false },
    { target: binding.target, signal });
}

/** Receives drag gestures from the frame that issued `binding`. Returns the unsubscribe function. */
export function subscribeAtomDrag(document: ViewerDocument, binding: GeometryBinding, receive: (event: AtomDragEvent) => void) {
  if (binding.target.documentId !== document.id) throw new Error("The Geometry binding belongs to another document.");
  // The frame window, not the body's documentId, identifies the sender: the
  // viewer reports its runtime id, which differs from the shell's document id.
  const listener = (event: MessageEvent) => {
    if (event.source !== binding.target.source || !binding.target.isCurrent()) return;
    const parsed = parseAtomDragMessage(event.data, binding.lease);
    if (parsed) receive(parsed);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/** Validates one untrusted frame message; returns null for anything else. */
export function parseAtomDragMessage(data: unknown, lease: string): AtomDragEvent | null {
  if (!data || typeof data !== "object" || (data as { source?: unknown }).source !== "burette-viewer") return null;
  const body = (data as { body?: unknown }).body as Record<string, unknown> | undefined;
  if (!body || body.type !== "atom-drag" || body.lease !== lease || !phases.has(body.phase)) return null;
  const { atoms, positions } = body;
  if (!Array.isArray(atoms) || !Array.isArray(positions) || !atoms.length || atoms.length > MAX_DRAGGED_ATOMS
    || positions.length !== atoms.length
    || !atoms.every(atom => Number.isSafeInteger(atom) && atom >= 0)
    || !positions.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))) return null;
  return { phase: body.phase as AtomDragPhase, lease, atoms: atoms as number[], positions: positions as [number, number, number][] };
}

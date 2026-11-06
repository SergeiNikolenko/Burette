import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ShellActions } from "../../components/types";
import type { ViewerDocument } from "../../types";

/** Avogadro's Extensions › Calculate and Optimize commands, run by the panel that edits the document. */
export type OptimizationCommand = "optimize" | "auto-optimize" | "calculate-energy" | "configure" | "freeze" | "unfreeze";
export type OptimizationCommandRequest = { documentId: string; command: OptimizationCommand; id: number };
/** The dock panel that owns a document's coordinates: Edit for SDF/MOL, Geometry for XYZ. */
export type OptimizationPanel = "structure-edit" | "geometry";

export const OPTIMIZATION_COMMANDS: readonly { command: OptimizationCommand; label: string }[] = [
  { command: "optimize", label: "Optimize Geometry" },
  { command: "auto-optimize", label: "Auto Optimize" },
  { command: "calculate-energy", label: "Calculate Energy" },
  { command: "configure", label: "Configure Optimization…" },
  { command: "freeze", label: "Freeze Selected Atoms" },
  { command: "unfreeze", label: "Unfreeze Selected Atoms" },
];

let current: OptimizationCommandRequest | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

/** Opens the owning panel and leaves the command for it; a panel mounting later still receives it. */
export function requestOptimizationCommand(actions: Pick<ShellActions, "setDockDocument" | "openDockTab">, document: ViewerDocument, panel: OptimizationPanel, command: OptimizationCommand) {
  actions.setDockDocument("right", document.id);
  actions.openDockTab("right", panel);
  current = { documentId: document.id, command, id: nextId++ };
  for (const listener of listeners) listener();
}

/** A handled request is dropped, so reopening the panel later does not repeat it. */
export function consumeOptimizationCommand(id: number) {
  if (current?.id === id) current = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useOptimizationCommand(documentId: string) {
  const request = useSyncExternalStore(subscribe, () => current, () => null);
  return request?.documentId === documentId ? request : null;
}

/** Runs each command once, when the panel has its structure; `handle` may change every render. */
export function useOptimizationCommandHandler(documentId: string, ready: boolean, handle: (command: OptimizationCommand) => void) {
  const request = useOptimizationCommand(documentId), latest = useRef(handle), handled = useRef(0);
  latest.current = handle;
  useEffect(() => {
    if (!request || !ready || handled.current === request.id) return;
    handled.current = request.id;
    consumeOptimizationCommand(request.id);
    latest.current(request.command);
  }, [request, ready]);
}

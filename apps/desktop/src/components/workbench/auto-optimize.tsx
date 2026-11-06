import { useEffect, useRef, useState } from "react";
import { setAtomDragMode, subscribeAtomDrag } from "../../lib/atom-drag";
import type { GeometryBinding } from "../../lib/geometry-binding";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { startAutoOptimize, type AutoOptimizeFrame, type AutoOptimizeSession } from "../../lib/molecular-workbench/auto-optimize-client";
import { energyModel, isExternalEnergyModelId, resolveEnergyModel } from "../../lib/molecular-workbench/energy-models";
import type { MolecularStructure } from "../../lib/molecular-workbench/molecular-graph";
import type { GeometryConstraint } from "../../lib/molecular-workbench/optimization";
import type { MolecularAtom, MolecularForceField, Vec3 } from "../../lib/molecular-workbench/types";
import { AUTO_OPTIMIZE_EXTERNAL, optimizerSettings, optimizerTolerances } from "../../lib/workbench/optimizer-settings";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

export type AutoOptimizeHandlers = {
  /** Each relaxed geometry while the session runs, for the 3D view. */
  frame: (atoms: MolecularAtom[]) => void;
  /** Stop with a changed geometry: publish it as one edit. */
  finish: (atoms: MolecularAtom[]) => void;
  /** Stop without a change, or after a failure: restore the view. */
  cancel: () => void;
};

/**
 * Avogadro's Auto Optimize tool: the structure relaxes continuously with the configured
 * model (Hybrid FIRE, then L-BFGS, as Avogadro), atoms dragged in the 3D view hold their
 * new positions while the others follow, and Stop publishes the result as one Undo step.
 * The panel assigns `handlers.current` every render; `binding` is the scene the frames preview
 * into, which also carries the drag gestures while a session runs.
 */
export function useAutoOptimize(document: ViewerDocument, binding: GeometryBinding | null, send: ShellActions["runStructureViewerAction"]) {
  const handlers = useRef<AutoOptimizeHandlers>({ frame: () => {}, finish: () => {}, cancel: () => {} });
  const session = useRef<AutoOptimizeSession | null>(null), latest = useRef<AutoOptimizeFrame | null>(null), moved = useRef(false);
  const [running, setRunning] = useState<{ model: MolecularForceField; frame: AutoOptimizeFrame | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => session.current?.stop(), []);

  const end = () => { session.current?.stop(); session.current = null; setRunning(null); };
  const start = (molecule: MolecularStructure, constraints: GeometryConstraint[]) => {
    end();
    setError(null);
    let model: MolecularForceField;
    try {
      const resolved = resolveEnergyModel(optimizerSettings().model, molecule);
      if (isExternalEnergyModelId(resolved)) throw new Error(AUTO_OPTIMIZE_EXTERNAL);
      model = resolved;
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); return; }
    latest.current = null; moved.current = false;
    setRunning({ model, frame: null });
    session.current = startAutoOptimize({ type: "start", molecule, forceField: model, method: "hybrid", constraints, gradientTolerance: optimizerTolerances().gradientTolerance },
      (frame) => { latest.current = frame; setRunning((current) => current && { ...current, frame }); handlers.current.frame(frame.atoms); },
      (message) => { end(); setError(message); handlers.current.cancel(); });
  };
  const stop = () => {
    const frame = latest.current;
    end();
    if (frame && (frame.iterations > 0 || moved.current)) handlers.current.finish(frame.atoms);
    else handlers.current.cancel();
  };
  const move = (atoms: number[], positions: Vec3[]) => { moved.current = true; session.current?.move(atoms, positions); };
  const release = () => session.current?.release();

  // Atoms dragged in the 3D view hold their positions; the viewer keeps them under the pointer.
  const active = Boolean(running);
  useEffect(() => {
    if (!active || !binding) return undefined;
    const controller = new AbortController();
    const unsubscribe = subscribeAtomDrag(document, binding, (event) => {
      move(event.atoms, event.positions);
      if (event.phase === "end" || event.phase === "cancel") release();
    });
    void setAtomDragMode(document, binding, true, send, controller.signal)
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { controller.abort(); unsubscribe(); void setAtomDragMode(document, binding, false, send).catch(() => {}); };
  }, [active, binding, document.id]);

  const frame = running?.frame;
  const status = running ? (
    <>
      <span role="status" className="workbench-status whitespace-nowrap" title={`Auto Optimize, ${energyModel(running.model).name}`}><Spinner aria-hidden className="size-3" />
        {frame ? `ΔE ${(frame.energy - frame.initialEnergy).toFixed(2)} kcal/mol` : "Auto Optimize"}
      </span>
      <Button type="button" variant="ghost" size="xs" onClick={stop}>Stop</Button>
    </>
  ) : null;
  return { running: Boolean(running), start, stop, move, release, handlers, status, error };
}

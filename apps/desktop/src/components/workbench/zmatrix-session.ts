import type { OptimizationResult, MolecularForceField } from "../../lib/molecular-workbench/chemistry";
import type { SourceEditingContextValue } from "../../lib/source-editing/context";
import type { ViewerDocument } from "../../types";

// A reloading scene reports through the source session; previews time out sooner.
const RELOAD_LIMIT_MS = 15_000;

export type OptimizationSummary = { forceField?: MolecularForceField; initialEnergy: number; energy: number; converged: boolean; residual: { distance: number | null; angle: number | null } | null };

export function summary(result: OptimizationResult): OptimizationSummary {
  const largest = (unit: "angstrom" | "degrees") => {
    const errors = result.constraintResiduals.filter((item) => item.unit === unit).map((item) => Math.abs(item.error));
    return errors.length ? Math.max(...errors) : null;
  };
  return {
    forceField: result.forceField, initialEnergy: result.initialEnergy, energy: result.energy, converged: result.converged,
    residual: result.constraintResiduals.length ? { distance: largest("angstrom"), angle: largest("degrees") } : null,
  };
}

/**
 * Waits for the scene of a draft that reloads (new atoms or atom order): `shown` once the
 * session reports the scene current with `content`, `failed` when the reload did not take
 * it (the previous structure is still shown), `moved` when the session holds other content
 * or closed meanwhile.
 */
export function sceneReload(sourceEditing: SourceEditingContextValue, document: ViewerDocument, content: string) {
  const started = Date.now();
  return new Promise<{ outcome: "shown" | "failed" | "moved"; diagnostic: string | null }>((resolve) => {
    const check = () => {
      const session = sourceEditing.sessionForDocument(document);
      if (!session || session.content !== content) return resolve({ outcome: "moved", diagnostic: null });
      const state = session.previewState ?? "current";
      if (state === "current") return resolve({ outcome: "shown", diagnostic: null });
      if ((state !== "queued" && state !== "staging") || Date.now() - started > RELOAD_LIMIT_MS) return resolve({ outcome: "failed", diagnostic: session.diagnostic });
      setTimeout(check, 50);
    };
    check();
  });
}

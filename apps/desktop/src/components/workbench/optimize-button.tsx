import { useState } from "react";
import type { MolecularForceField } from "../../lib/molecular-workbench/forcefield";
import { OPTIMIZATION_LIMITS, OPTIMIZATION_METHODS, RESIDUAL_TOLERANCE, defaultOptimizationMethod, optimizationUnavailable, type ConstraintResidual, type OptimizationFrame, type OptimizationMethod, type OptimizationProgress } from "../../lib/molecular-workbench/optimization";
import { HARTREE_KCAL_MOL, fileStem } from "../../lib/workbench/formats";
import { openScientificDocument } from "../../lib/workbench/generated-document-open";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { ChevronDown } from "../ui/app-icons";
import { Button } from "../ui/button";
import { ButtonGroup } from "../ui/button-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Spinner } from "../ui/spinner";
import "./geometry.css";

const LABELS: Record<OptimizationMethod, string> = { bfgs: "BFGS", lbfgs: "L-BFGS", fire: "FIRE", "abc-fire": "ABC-FIRE", hybrid: "FIRE, then L-BFGS" };
const FORCE_FIELDS: MolecularForceField[] = ["MMFF94", "MMFF94s", "UFF"];
const METHOD_KEY = "burette.workbench.optimizer";
const FIELD_KEY = "burette.workbench.force-field";
const STEPS_KEY = "burette.workbench.optimizer-steps";
// The minimizer's default is 250 accepted steps; 1000 is the shared upper bound.
const STEP_LIMITS = ["100", "250", "500", String(OPTIMIZATION_LIMITS.iterations)] as const;

function stored<T extends string>(key: string, values: readonly T[]): T | null {
  try { const value = localStorage.getItem(key); return values.includes(value as T) ? value as T : null; } catch { return null; }
}
function remember(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: keep the choice for this view */ }
}

export function optimizerLabel(method: OptimizationMethod) { return LABELS[method]; }

/** Opens the minimizer steps as a trajectory; kcal/mol become hartree so Plots can chart them in any unit. */
export function OpenStepsButton({ actions, document, frames }: { actions: ShellActions; document: ViewerDocument; frames: readonly OptimizationFrame[] | undefined }) {
  if (!frames || frames.length < 2) return null;
  return (
    <Button type="button" variant="ghost" size="xs" onClick={() => void openScientificDocument(actions, `${fileStem(document.title)}-optimization`, {
      format: "xyz", atoms: frames[0].atoms, modes: [], orbitals: [],
      frames: frames.map((frame) => ({ atoms: frame.atoms, energyHartree: frame.energy / HARTREE_KCAL_MOL })),
    }, "steps")}>Open steps</Button>
  );
}

/** Measured values of the held coordinates after an optimization, with their signed deviation from the target. */
export function ConstraintResiduals({ residuals, atomLabel }: { residuals: readonly ConstraintResidual[]; atomLabel: (atom: number) => string }) {
  if (!residuals.length) return null;
  return (
    <ul aria-label="Constraint residuals" className="geometry-panel-residuals">
      {residuals.map((item) => {
        const unit = item.unit === "angstrom" ? "Å" : "°", digits = item.unit === "angstrom" ? 3 : 1;
        return (
          <li key={`${item.kind}:${item.atoms.join(",")}`}>
            <span>{item.atoms.map(atomLabel).join("–")}</span>
            <span>{item.value.toFixed(digits)} {unit}</span>
            <span data-status={Math.abs(item.error) <= RESIDUAL_TOLERANCE[item.unit] ? "success" : "failure"} className="workbench-value">
              {item.error >= 0 ? "+" : "−"}{Math.abs(item.error).toFixed(digits)} {unit}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The running status of an optimization: the latest accepted step once the worker reports one. */
export function OptimizingStatus({ progress }: { progress: OptimizationProgress | null }) {
  return (
    <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />
      {progress ? `Step ${progress.iteration}, ${progress.energy.toFixed(2)} kcal/mol` : "Optimizing"}
    </span>
  );
}

/**
 * Optimize with an explicit method; the menu beside it picks the force field and method.
 * The checked method is the one that runs. `coupled` optimizations move shared Z-matrix
 * variables by differencing the energy, which bounds their size.
 */
export function OptimizeButton({ atomCount, constraintCount = 0, coupled = false, unavailableReason, disabled, size = "default", variant = "default", onOptimize }: {
  atomCount: number; constraintCount?: number; coupled?: boolean; unavailableReason?: string | null;
  disabled?: boolean; size?: "default" | "xs"; variant?: "default" | "secondary";
  onOptimize: (method: OptimizationMethod, forceField: MolecularForceField, maxIterations: number) => void;
}) {
  const [preferred, setPreferred] = useState(() => stored(METHOD_KEY, OPTIMIZATION_METHODS));
  const [forceField, setForceField] = useState<MolecularForceField>(() => stored(FIELD_KEY, FORCE_FIELDS) ?? "MMFF94");
  const [steps, setSteps] = useState(() => stored(STEPS_KEY, STEP_LIMITS) ?? "250");
  const method = preferred ?? defaultOptimizationMethod(forceField, constraintCount > 0 || coupled);
  const blocked = unavailableReason ?? optimizationUnavailable(atomCount, constraintCount)
    ?? (coupled && atomCount > OPTIMIZATION_LIMITS.numericalAtoms ? `Coupled Z-matrix optimization supports up to ${OPTIMIZATION_LIMITS.numericalAtoms} atoms; this structure has ${atomCount}.` : null);
  return (
    <ButtonGroup>
      <Button type="button" variant={variant} size={size} disabled={disabled || Boolean(blocked)} title={blocked ?? `${forceField}, ${LABELS[method]}, up to ${steps} steps`}
        onClick={() => onOptimize(method, forceField, Number(steps))}>Optimize</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant={variant} size={size === "xs" ? "icon-xs" : "icon"} disabled={disabled} aria-label={`Optimization method: ${LABELS[method]}, ${forceField}`}>
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Force field</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={forceField} onValueChange={(value) => {
            if (!FORCE_FIELDS.includes(value as MolecularForceField)) return;
            setForceField(value as MolecularForceField); remember(FIELD_KEY, value);
          }}>
            {FORCE_FIELDS.map((field) => <DropdownMenuRadioItem key={field} value={field}>{field}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Minimizer</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={method} onValueChange={(value) => {
            if (!OPTIMIZATION_METHODS.includes(value as OptimizationMethod)) return;
            setPreferred(value as OptimizationMethod); remember(METHOD_KEY, value);
          }}>
            {OPTIMIZATION_METHODS.map((item) => <DropdownMenuRadioItem key={item} value={item}>{LABELS[item]}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Step limit</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={steps} onValueChange={(value) => {
            if (!STEP_LIMITS.includes(value as typeof STEP_LIMITS[number])) return;
            setSteps(value as typeof STEP_LIMITS[number]); remember(STEPS_KEY, value);
          }}>
            {STEP_LIMITS.map((item) => <DropdownMenuRadioItem key={item} value={item}>{item}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}

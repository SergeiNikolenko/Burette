import { useState } from "react";
import { isExternalEnergyModelId, type EnergyModelChoice } from "../../lib/molecular-workbench/energy-models";
import { energyModelName, useEnergyModelOptions } from "../../lib/molecular-workbench/external-energy-models";
import { energyWithModel } from "../../lib/molecular-workbench/optimize-with-model";
import { OPTIMIZATION_LIMITS, OPTIMIZATION_METHODS, RESIDUAL_TOLERANCE, optimizationUnavailable, type ConstraintResidual, type OptimizationFrame, type OptimizationMethod, type OptimizationProgress } from "../../lib/molecular-workbench/optimization";
import { HARTREE_KCAL_MOL, fileStem } from "../../lib/workbench/formats";
import { openScientificDocument } from "../../lib/workbench/generated-document-open";
import { AUTO_OPTIMIZE_EXTERNAL, optimizationRun, optimizerSettings as settingsSnapshot, updateOptimizerSettings, useOptimizerSettings } from "../../lib/workbench/optimizer-settings";
import type { MolecularStructure } from "../../lib/molecular-workbench/molecular-graph";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { ChevronDown } from "../ui/app-icons";
import { Button } from "../ui/button";
import { ButtonGroup } from "../ui/button-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Spinner } from "../ui/spinner";
import { METHOD_LABELS as LABELS, OptimizerSettingsDialog } from "./optimizer-settings-dialog";
import "./geometry.css";

// The minimizer's default is 250 accepted steps; 1000 is the shared upper bound. Configure takes any limit in between.
const STEP_LIMITS = ["100", "250", "500", String(OPTIMIZATION_LIMITS.iterations)] as const;

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

type EnergyNote = { structure: object; text: string; failed?: boolean } | null;

/** Avogadro's Calculate Energy: the single-point energy of a structure with the configured model.
 * The note belongs to the structure it describes and disappears once that changes. */
export function useEnergyCalculation(current: object | null | undefined) {
  const [note, setNote] = useState<EnergyNote>(null);
  const calculate = async (structure: MolecularStructure, owner: object = structure) => {
    try {
      const { model, energy } = await energyWithModel(structure, settingsSnapshot().model);
      setNote({ structure: owner, text: `${energyModelName(model)} energy ${energy.toFixed(2)} kcal/mol` });
    } catch (error) { setNote({ structure: owner, text: error instanceof Error ? error.message : String(error), failed: true }); }
  };
  const shown = note && note.structure === current ? note : null;
  return { calculate, line: shown ? <p role={shown.failed ? "alert" : "status"} className="workbench-status">{shown.text}</p> : null };
}

/**
 * Optimize with an explicit method; the menu beside it picks the force field and method.
 * The checked method is the one that runs. `coupled` optimizations move shared Z-matrix
 * variables through differenced derivatives, which bounds their size. Automatic is passed on
 * as "auto": the caller resolves it once the structure's bond graph is known.
 */
export function OptimizeButton({ atomCount, elements = [], constraintCount = 0, coupled = false, unavailableReason, disabled, size = "default", variant = "default", configureOpen, onConfigureOpenChange, onOptimize, onAutoOptimize }: {
  atomCount: number; elements?: readonly string[]; constraintCount?: number; coupled?: boolean; unavailableReason?: string | null;
  disabled?: boolean; size?: "default" | "xs"; variant?: "default" | "secondary";
  /** Configure Optimization… is open; a panel controls it to open the dialog from a command. */
  configureOpen?: boolean; onConfigureOpenChange?: (open: boolean) => void;
  onOptimize: (method: OptimizationMethod, forceField: EnergyModelChoice, maxIterations: number) => void;
  /** Avogadro's continuous relaxation; the item shows only where a panel supports it. */
  onAutoOptimize?: () => void;
}) {
  const settings = useOptimizerSettings(), steps = String(settings.steps);
  const [ownConfigureOpen, setOwnConfigureOpen] = useState(false);
  const configuring = configureOpen ?? ownConfigureOpen, setConfiguring = onConfigureOpenChange ?? setOwnConfigureOpen;
  const models = useEnergyModelOptions(elements);
  const choice = settings.model === "auto" || models.some((model) => model.id === settings.model) ? settings.model : "auto";
  const { method } = optimizationRun({ ...settings, model: choice }, elements, constraintCount > 0 || coupled);
  const modelReason = models.find((model) => model.id === choice)?.unavailable ?? null;
  const blocked = unavailableReason ?? optimizationUnavailable(atomCount, constraintCount) ?? modelReason
    ?? (coupled && atomCount > OPTIMIZATION_LIMITS.numericalAtoms ? `Coupled Z-matrix optimization supports up to ${OPTIMIZATION_LIMITS.numericalAtoms} atoms; this structure has ${atomCount}.` : null);
  const autoReason = isExternalEnergyModelId(choice) ? AUTO_OPTIMIZE_EXTERNAL : null;
  return (
    <ButtonGroup>
      <Button type="button" variant={variant} size={size} disabled={disabled || Boolean(blocked)} title={blocked ?? `${choice === "auto" ? "Automatic" : energyModelName(choice)}, ${LABELS[method]}, up to ${steps} steps`}
        onClick={() => onOptimize(method, choice, Number(steps))}>Optimize</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant={variant} size={size === "xs" ? "icon-xs" : "icon"} disabled={disabled} aria-label={`Optimization method: ${LABELS[method]}, ${choice === "auto" ? "Automatic" : energyModelName(choice)}`}>
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Force field</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={choice} onValueChange={(value) => updateOptimizerSettings({ model: value as EnergyModelChoice })}>
            <DropdownMenuRadioItem value="auto">Automatic</DropdownMenuRadioItem>
            {models.map((model) => (
              <DropdownMenuRadioItem key={model.id} value={model.id} disabled={Boolean(model.unavailable)} title={model.unavailable ?? undefined}>{model.name}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Minimizer</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={method} onValueChange={(value) => updateOptimizerSettings({ method: value as OptimizationMethod })}>
            {OPTIMIZATION_METHODS.map((item) => <DropdownMenuRadioItem key={item} value={item}>{LABELS[item]}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Step limit</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={steps} onValueChange={(value) => updateOptimizerSettings({ steps: Number(value) })}>
            {STEP_LIMITS.map((item) => <DropdownMenuRadioItem key={item} value={item}>{item}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          {onAutoOptimize ? <DropdownMenuItem disabled={Boolean(blocked ?? autoReason)} title={autoReason ?? undefined} onSelect={onAutoOptimize}>Auto Optimize</DropdownMenuItem> : null}
          <DropdownMenuItem onSelect={() => setConfiguring(true)}>Configure…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <OptimizerSettingsDialog open={configuring} onOpenChange={setConfiguring} elements={elements} />
    </ButtonGroup>
  );
}

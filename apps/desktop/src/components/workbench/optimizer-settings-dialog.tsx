import { useState } from "react";
import { ENERGY_MODELS, energyModelUnavailable, type EnergyModelChoice } from "../../lib/molecular-workbench/energy-models";
import { OPTIMIZATION_LIMITS, OPTIMIZATION_METHODS, type OptimizationMethod } from "../../lib/molecular-workbench/optimization";
import { ENERGY_EXPONENTS, GRADIENT_EXPONENTS, updateOptimizerSettings, useOptimizerSettings, type OptimizerSettings } from "../../lib/workbench/optimizer-settings";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";

export const METHOD_LABELS: Record<OptimizationMethod, string> = { bfgs: "BFGS", lbfgs: "L-BFGS", fire: "FIRE", "abc-fire": "ABC-FIRE", hybrid: "FIRE, then L-BFGS" };

function Exponent({ label, unit, value, range, onChange }: { label: string; unit: string; value: number; range: { min: number; max: number }; onChange: (value: number) => void }) {
  return (
    <label className="workbench-field"><span>{label}</span>
      <span className="workbench-row">10^
        <Input aria-label={`${label} exponent`} type="number" variant="compact" className="w-16" min={range.min} max={range.max} step={1} value={value}
          onChange={(event) => { const next = Number(event.target.value); if (Number.isInteger(next)) onChange(Math.min(range.max, Math.max(range.min, next))); }} />
        {unit}
      </span>
    </label>
  );
}

/** Avogadro's Geometry Optimization Parameters: the model, minimizer, step limit and convergence of every optimization. */
export function OptimizerSettingsDialog({ open, onOpenChange, elements }: { open: boolean; onOpenChange: (open: boolean) => void; elements: readonly string[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <DialogContent variant="form" aria-describedby={undefined}><SettingsForm elements={elements} onDone={() => onOpenChange(false)} /></DialogContent> : null}
    </Dialog>
  );
}

function SettingsForm({ elements, onDone }: { elements: readonly string[]; onDone: () => void }) {
  const saved = useOptimizerSettings();
  const [draft, setDraft] = useState<OptimizerSettings>(saved);
  const set = (patch: Partial<OptimizerSettings>) => setDraft((current) => ({ ...current, ...patch }));
  const atoms = elements.map((element) => ({ element }));
  return <>
    <DialogHeader><DialogTitle>Configure Optimization</DialogTitle></DialogHeader>
    <div className="workbench-form">
      <label className="workbench-field"><span>Force field</span>
        <NativeSelect aria-label="Force field" size="sm" value={draft.model} onChange={(event) => set({ model: event.target.value as EnergyModelChoice })}>
          <NativeSelectOption value="auto">Automatic</NativeSelectOption>
          {ENERGY_MODELS.map((model) => {
            const reason = energyModelUnavailable(model.id, atoms);
            return <NativeSelectOption key={model.id} value={model.id} disabled={Boolean(reason)} title={reason ?? undefined}>{model.name}</NativeSelectOption>;
          })}
        </NativeSelect>
      </label>
      <label className="workbench-field"><span>Minimizer</span>
        <NativeSelect aria-label="Minimizer" size="sm" value={draft.method ?? "default"} onChange={(event) => set({ method: event.target.value === "default" ? null : event.target.value as OptimizationMethod })}>
          <NativeSelectOption value="default">Default for the force field</NativeSelectOption>
          {OPTIMIZATION_METHODS.map((method) => <NativeSelectOption key={method} value={method}>{METHOD_LABELS[method]}</NativeSelectOption>)}
        </NativeSelect>
      </label>
      <label className="workbench-field"><span>Step limit</span>
        <Input aria-label="Step limit" type="number" variant="compact" className="w-24" min={1} max={OPTIMIZATION_LIMITS.iterations} step={1} value={draft.steps}
          onChange={(event) => { const next = Number(event.target.value); if (Number.isInteger(next)) set({ steps: Math.min(OPTIMIZATION_LIMITS.iterations, Math.max(1, next)) }); }} />
      </label>
      <Exponent label="Energy convergence" unit="kcal/mol" value={draft.energyExponent} range={ENERGY_EXPONENTS} onChange={(energyExponent) => set({ energyExponent })} />
      <Exponent label="Gradient convergence" unit="kcal/(mol·Å)" value={draft.gradientExponent} range={GRADIENT_EXPONENTS} onChange={(gradientExponent) => set({ gradientExponent })} />
    </div>
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
      <Button type="button" onClick={() => { updateOptimizerSettings(draft); onDone(); }}>Save</Button>
    </DialogFooter>
  </>;
}

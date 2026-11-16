import { useSyncExternalStore } from "react";
import { ENERGY_MODELS, isExternalEnergyModelId, recommendedEnergyModel, type EnergyModelChoice } from "../molecular-workbench/energy-models";
import { OPTIMIZATION_LIMITS, OPTIMIZATION_METHODS, defaultOptimizationMethod, type OptimizationMethod } from "../molecular-workbench/optimization";

/** The Optimize menu, Configure dialog and Optimize Geometry command share these choices.
 * Convergence is 10^exponent: kcal/mol per step averaged over ten steps for the energy
 * (Avogadro's energy window) and kcal/(mol·Å) for the largest gradient component. */
export type OptimizerSettings = {
  model: EnergyModelChoice; method: OptimizationMethod | null; steps: number;
  energyExponent: number; gradientExponent: number;
};

const KEYS = {
  model: "burette.workbench.force-field", method: "burette.workbench.optimizer", steps: "burette.workbench.optimizer-steps",
  energyExponent: "burette.workbench.optimizer-energy-exponent", gradientExponent: "burette.workbench.optimizer-gradient-exponent",
} as const;
const MODELS: readonly string[] = ["auto", ...ENERGY_MODELS.map((model) => model.id)];
export const ENERGY_EXPONENTS = { min: -10, max: -1, default: -5 } as const;
export const GRADIENT_EXPONENTS = { min: -8, max: 0, default: -3 } as const;
/** Auto Optimize relaxes each frame in the browser worker; an external model answers one process call at a time. */
export const AUTO_OPTIMIZE_EXTERNAL = "Auto Optimize runs MMFF94, MMFF94s, UFF or Lennard-Jones; choose one of them for continuous relaxation.";

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
const integer = (value: string | null, min: number, max: number) => {
  const number = value === null ? Number.NaN : Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
};

let cache: { raw: string; settings: OptimizerSettings } | null = null;
function snapshot(): OptimizerSettings {
  const values = Object.values(KEYS).map(read), raw = JSON.stringify(values);
  if (cache?.raw === raw) return cache.settings;
  const [model, method, steps, energy, gradient] = values;
  const settings: OptimizerSettings = {
    // An external model counts once the desktop shell lists it; consumers fall back to Automatic until then.
    model: model !== null && (MODELS.includes(model) || isExternalEnergyModelId(model)) ? model as EnergyModelChoice : "auto",
    method: OPTIMIZATION_METHODS.includes(method as OptimizationMethod) ? method as OptimizationMethod : null,
    steps: integer(steps, 1, OPTIMIZATION_LIMITS.iterations) ?? 250,
    energyExponent: integer(energy, ENERGY_EXPONENTS.min, ENERGY_EXPONENTS.max) ?? ENERGY_EXPONENTS.default,
    gradientExponent: integer(gradient, GRADIENT_EXPONENTS.min, GRADIENT_EXPONENTS.max) ?? GRADIENT_EXPONENTS.default,
  };
  cache = { raw, settings };
  return settings;
}

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function updateOptimizerSettings(patch: Partial<OptimizerSettings>) {
  for (const [field, value] of Object.entries(patch) as [keyof OptimizerSettings, OptimizerSettings[keyof OptimizerSettings]][]) {
    try {
      if (value === null) localStorage.removeItem(KEYS[field]);
      else localStorage.setItem(KEYS[field], String(value));
    } catch { /* storage unavailable: the choice lasts for this view */ }
  }
  for (const listener of listeners) listener();
}

/** The current settings outside React. */
export function optimizerSettings() { return snapshot(); }

export function useOptimizerSettings() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The minimizer tolerances of the current settings, in kcal/mol and kcal/(mol·Å). */
export function optimizerTolerances(settings: OptimizerSettings = snapshot()) {
  return { energyTolerance: 10 ** settings.energyExponent, gradientTolerance: 10 ** settings.gradientExponent };
}

/** What Optimize runs with these settings: the method defaults to the likely field's
 * (Automatic is resolved later, on the parsed structure). */
export function optimizationRun(settings: OptimizerSettings, elements: readonly string[], constrained: boolean) {
  const likely = settings.model === "auto" ? recommendedEnergyModel(elements.map((element) => ({ element }))) : settings.model;
  return { method: settings.method ?? defaultOptimizationMethod(likely, constrained), model: settings.model, maxIterations: settings.steps };
}

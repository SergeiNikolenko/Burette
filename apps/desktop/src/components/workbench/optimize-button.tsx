import { useState } from "react";
import type { MolecularForceField } from "../../lib/molecular-workbench/forcefield";
import { OPTIMIZATION_LIMITS, OPTIMIZATION_METHODS, defaultOptimizationMethod, optimizationUnavailable, type OptimizationMethod } from "../../lib/molecular-workbench/optimization";
import { ChevronDown } from "../ui/app-icons";
import { Button } from "../ui/button";
import { ButtonGroup } from "../ui/button-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../ui/dropdown-menu";

const LABELS: Record<OptimizationMethod, string> = { bfgs: "BFGS", lbfgs: "L-BFGS", fire: "FIRE", "abc-fire": "ABC-FIRE", hybrid: "FIRE, then L-BFGS" };
const FORCE_FIELDS: MolecularForceField[] = ["MMFF94", "MMFF94s", "UFF"];
const METHOD_KEY = "burette.workbench.optimizer";
const FIELD_KEY = "burette.workbench.force-field";

function stored<T extends string>(key: string, values: readonly T[]): T | null {
  try { const value = localStorage.getItem(key); return values.includes(value as T) ? value as T : null; } catch { return null; }
}
function remember(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: keep the choice for this view */ }
}

export function optimizerLabel(method: OptimizationMethod) { return LABELS[method]; }

/**
 * Optimize with an explicit method; the menu beside it picks the force field and method.
 * The checked method is the one that runs. `coupled` optimizations move shared Z-matrix
 * variables by differencing the energy, which bounds their size.
 */
export function OptimizeButton({ atomCount, constraintCount = 0, coupled = false, unavailableReason, disabled, size = "default", variant = "default", onOptimize }: {
  atomCount: number; constraintCount?: number; coupled?: boolean; unavailableReason?: string | null;
  disabled?: boolean; size?: "default" | "xs"; variant?: "default" | "secondary";
  onOptimize: (method: OptimizationMethod, forceField: MolecularForceField) => void;
}) {
  const [preferred, setPreferred] = useState(() => stored(METHOD_KEY, OPTIMIZATION_METHODS));
  const [forceField, setForceField] = useState<MolecularForceField>(() => stored(FIELD_KEY, FORCE_FIELDS) ?? "MMFF94");
  const method = preferred ?? defaultOptimizationMethod(forceField, constraintCount > 0 || coupled);
  const blocked = unavailableReason ?? optimizationUnavailable(atomCount, constraintCount)
    ?? (coupled && atomCount > OPTIMIZATION_LIMITS.numericalAtoms ? `Coupled Z-matrix optimization supports up to ${OPTIMIZATION_LIMITS.numericalAtoms} atoms; this structure has ${atomCount}.` : null);
  return (
    <ButtonGroup>
      <Button type="button" variant={variant} size={size} disabled={disabled || Boolean(blocked)} title={blocked ?? `${forceField}, ${LABELS[method]}`}
        onClick={() => onOptimize(method, forceField)}>Optimize</Button>
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
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}

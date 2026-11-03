import { useState } from "react";
import type { MolecularForceField } from "../../lib/molecular-workbench/forcefield";
import { OPTIMIZATION_METHODS, defaultOptimizationMethod, optimizationUnavailable, type OptimizationMethod } from "../../lib/molecular-workbench/optimization";
import { ChevronDown } from "../ui/app-icons";
import { Button } from "../ui/button";
import { ButtonGroup } from "../ui/button-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../ui/dropdown-menu";

const LABELS: Record<OptimizationMethod, string> = { bfgs: "BFGS", lbfgs: "L-BFGS", fire: "FIRE", "abc-fire": "ABC-FIRE", hybrid: "FIRE, then L-BFGS" };
const FORCE_FIELDS: MolecularForceField[] = ["MMFF94", "MMFF94s", "UFF"];
const METHOD_KEY = "burette.workbench.optimizer";
const FIELD_KEY = "burette.workbench.force-field";
const COUPLED_REASON = "BFGS cannot keep Z-matrix variables coupled. Choose L-BFGS, FIRE, ABC-FIRE or hybrid.";

function stored<T extends string>(key: string, values: readonly T[]): T | null {
  try { const value = localStorage.getItem(key); return values.includes(value as T) ? value as T : null; } catch { return null; }
}
function remember(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: keep the choice for this view */ }
}

export function optimizerLabel(method: OptimizationMethod) { return LABELS[method]; }

/** Why `method` cannot run here, or null. `coupled` optimizations move shared Z-matrix variables. */
function methodUnavailable(method: OptimizationMethod, atomCount: number, forceField: MolecularForceField, constraintCount: number, coupled: boolean) {
  return optimizationUnavailable(atomCount, forceField, method, constraintCount) ?? (coupled && method === "bfgs" ? COUPLED_REASON : null);
}

/**
 * Optimize with an explicit method; the menu beside it picks the force field and method.
 * A remembered method that cannot run here is shown disabled with its reason, and the
 * checked method is the one that runs, so nothing is substituted unseen.
 */
export function OptimizeButton({ atomCount, constraintCount = 0, coupled = false, unavailableReason, disabled, size = "default", variant = "default", onOptimize }: {
  atomCount: number; constraintCount?: number; coupled?: boolean; unavailableReason?: string | null;
  disabled?: boolean; size?: "default" | "xs"; variant?: "default" | "secondary";
  onOptimize: (method: OptimizationMethod, forceField: MolecularForceField) => void;
}) {
  const [preferred, setPreferred] = useState(() => stored(METHOD_KEY, OPTIMIZATION_METHODS));
  const [forceField, setForceField] = useState<MolecularForceField>(() => stored(FIELD_KEY, FORCE_FIELDS) ?? "MMFF94");
  const reason = (method: OptimizationMethod) => methodUnavailable(method, atomCount, forceField, constraintCount, coupled);
  const fallback = defaultOptimizationMethod(forceField, constraintCount > 0 || coupled);
  const method = preferred && !reason(preferred) ? preferred : fallback;
  const blocked = unavailableReason ?? reason(method);
  // A force field is unavailable when no method can run it; L-BFGS carries the general reason.
  const fieldReason = (field: MolecularForceField) => OPTIMIZATION_METHODS.every(item => methodUnavailable(item, atomCount, field, constraintCount, coupled))
    ? methodUnavailable("lbfgs", atomCount, field, constraintCount, coupled) : null;
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
            {FORCE_FIELDS.map((field) => {
              const unavailable = fieldReason(field);
              return <DropdownMenuRadioItem key={field} value={field} disabled={Boolean(unavailable)} title={unavailable ?? undefined}>{field}</DropdownMenuRadioItem>;
            })}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Minimizer</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={method} onValueChange={(value) => {
            if (!OPTIMIZATION_METHODS.includes(value as OptimizationMethod)) return;
            setPreferred(value as OptimizationMethod); remember(METHOD_KEY, value);
          }}>
            {OPTIMIZATION_METHODS.map((item) => {
              const unavailable = reason(item);
              return <DropdownMenuRadioItem key={item} value={item} disabled={Boolean(unavailable)} title={unavailable ?? undefined}>{LABELS[item]}</DropdownMenuRadioItem>;
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}

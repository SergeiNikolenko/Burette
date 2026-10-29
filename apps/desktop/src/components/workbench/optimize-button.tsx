import { useState } from "react";
import type { MolecularForceField } from "../../lib/molecular-workbench/forcefield";
import type { MinimizerMethod } from "../../lib/molecular-workbench/minimizer";
import { ChevronDown } from "../ui/app-icons";
import { Button } from "../ui/button";
import { ButtonGroup } from "../ui/button-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../ui/dropdown-menu";

/** `default` is the force field's own minimizer; the others integrate the same MMFF94 energy numerically. */
export type OptimizerChoice = "default" | MinimizerMethod;
const CHOICES: { value: OptimizerChoice; label: string }[] = [
  { value: "default", label: "L-BFGS" },
  { value: "fire", label: "FIRE" },
  { value: "abc-fire", label: "ABC-FIRE" },
  { value: "hybrid", label: "FIRE, then L-BFGS" },
];
const NUMERICAL_ATOM_LIMIT = 64;
const STORAGE_KEY = "burette.workbench.optimizer";

function storedChoice(): OptimizerChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return CHOICES.some((choice) => choice.value === value) ? value as OptimizerChoice : "default";
  } catch { return "default"; }
}

/** The method for an optimization request; numerical methods apply only up to their atom limit. */
export function optimizerMethod(choice: OptimizerChoice, atomCount: number): MinimizerMethod | undefined {
  return choice === "default" || atomCount > NUMERICAL_ATOM_LIMIT ? undefined : choice;
}

export function optimizerLabel(method: MinimizerMethod | undefined) {
  return CHOICES.find((choice) => choice.value === (method === "lbfgs" ? "default" : method ?? "default"))!.label;
}

/** Optimize with the chosen method; the menu beside it picks the method and remembers it. */
export function OptimizeButton({ atomCount, disabled, size = "default", variant = "default", onOptimize }: {
  atomCount: number; disabled?: boolean; size?: "default" | "xs"; variant?: "default" | "secondary";
  onOptimize: (method: MinimizerMethod | undefined, forceField: MolecularForceField) => void;
}) {
  const [choice, setChoice] = useState<OptimizerChoice>(storedChoice);
  const [forceField, setForceField] = useState<MolecularForceField>(() => {
    try { const value = localStorage.getItem("burette.workbench.force-field"); return value === "MMFF94s" || value === "UFF" ? value : "MMFF94"; } catch { return "MMFF94"; }
  });
  const chooseField = (value: string) => {
    if (value !== "MMFF94" && value !== "MMFF94s" && value !== "UFF") return;
    setForceField(value);
    try { localStorage.setItem("burette.workbench.force-field", value); } catch { /* storage unavailable */ }
  };
  const fieldUnavailable = forceField === "UFF" && atomCount > NUMERICAL_ATOM_LIMIT;
  const numericalAllowed = atomCount <= NUMERICAL_ATOM_LIMIT;
  const method = optimizerMethod(choice, atomCount);
  const choose = (value: string) => {
    setChoice(value as OptimizerChoice);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* storage unavailable: keep the choice for this view */ }
  };
  return (
    <ButtonGroup>
      <Button type="button" variant={variant} size={size} disabled={disabled || fieldUnavailable} title={fieldUnavailable ? "UFF optimization supports up to 64 atoms" : undefined} onClick={() => onOptimize(method, forceField)}>Optimize</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant={variant} size={size === "xs" ? "icon-xs" : "icon"} disabled={disabled} aria-label={`Optimization method: ${optimizerLabel(method)}, ${forceField}`}>
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Force field</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={forceField} onValueChange={chooseField}>
            <DropdownMenuRadioItem value="MMFF94">MMFF94</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="MMFF94s">MMFF94s</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="UFF" disabled={!numericalAllowed} title={!numericalAllowed ? "Up to 64 atoms" : undefined}>UFF</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Minimizer</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={method ?? "default"} onValueChange={choose}>
            {CHOICES.map((item) => {
              const unavailable = item.value !== "default" && !numericalAllowed;
              return (
                <DropdownMenuRadioItem key={item.value} value={item.value} disabled={unavailable} title={unavailable ? `Up to ${NUMERICAL_ATOM_LIMIT} atoms` : undefined}>
                  {item.label}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}

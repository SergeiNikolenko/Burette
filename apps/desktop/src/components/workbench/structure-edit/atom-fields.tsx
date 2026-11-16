import { useState, type KeyboardEvent } from "react";
import type { GraphEdit, GraphEditResult } from "../../../lib/molecular-workbench/graph-edit";
import type { AtomAnnotation } from "../../../lib/workbench/graph-draft";
import type { Vec3 } from "../../../lib/molecular-workbench/types";
import { Input } from "../../ui/input";
import { ScrubNumberField } from "../../ui/scrub-number-input";
import { normalizeElement, signed } from "./values";

export function AtomFields({ structure, annotation, atom, disabled, onApply, onError }: {
  structure: GraphEditResult; annotation: AtomAnnotation | undefined; atom: number; disabled: boolean;
  onApply: (edits: GraphEdit[]) => void; onError: (error: string) => void;
}) {
  const current = structure.atoms[atom];
  const [element, setElement] = useState(current.element);
  const [mass, setMass] = useState(annotation?.isotope ? String(annotation.isotope) : "");
  const commitElement = () => {
    const symbol = normalizeElement(element);
    if (!symbol) { onError(`Enter an element symbol, such as C or Cl.`); setElement(current.element); return; }
    if (symbol !== current.element) onApply([{ kind: "update-atom", index: atom, element: symbol }]);
    else setElement(symbol);
  };
  const commitMass = () => {
    const text = mass.trim();
    const isotope = text === "" ? 0 : Number(text);
    if (!Number.isInteger(isotope) || isotope < 0) { onError("Enter a whole mass number, or leave it empty for natural abundance."); setMass(annotation?.isotope ? String(annotation.isotope) : ""); return; }
    if (isotope !== (annotation?.isotope ?? 0)) onApply([{ kind: "update-atom", index: atom, isotope }]);
  };
  const position: Vec3 = [current.x, current.y, current.z];
  const commitAxis = (axis: 0 | 1 | 2, value: number) => {
    if (Math.abs(value - position[axis]) < 1e-6) return;
    const next: Vec3 = [...position];
    next[axis] = value;
    onApply([{ kind: "update-atom", index: atom, position: next }]);
  };
  const submitOnEnter = (commit: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
  };
  return (
    <div className="workbench-form">
      <div className="workbench-grid workbench-grid-3">
        <label className="workbench-field">
          <span>Element</span>
          <Input variant="compact" value={element} maxLength={3} spellCheck={false} autoComplete="off" disabled={disabled}
            onChange={(event) => setElement(event.target.value)} onBlur={commitElement} onKeyDown={submitOnEnter(commitElement)} />
        </label>
        <label className="workbench-field">
          <span>Charge</span>
          <ScrubNumberField aria-label="Formal charge" value={annotation?.charge ?? 0} min={-8} max={8} step={1} smallStep={1} largeStep={1} disabled={disabled}
            formatValue={(value) => signed(Math.round(value))}
            onValueCommitted={(value) => { const charge = Math.round(value); if (charge !== (annotation?.charge ?? 0)) onApply([{ kind: "update-atom", index: atom, charge }]); }} />
        </label>
        <label className="workbench-field">
          <span>Mass number</span>
          <Input variant="compact" value={mass} inputMode="numeric" placeholder="Natural" autoComplete="off" disabled={disabled}
            onChange={(event) => setMass(event.target.value)} onBlur={commitMass} onKeyDown={submitOnEnter(commitMass)} />
        </label>
      </div>
      <div className="workbench-grid workbench-grid-3">
        {(["X", "Y", "Z"] as const).map((name, axis) => (
          <label key={name} className="workbench-field">
            <span>{name}, Å</span>
            <ScrubNumberField aria-label={`${name}, Å`} value={position[axis]} step={0.01} smallStep={0.001} largeStep={0.1} disabled={disabled}
              formatValue={(value) => value.toFixed(4)} onValueCommitted={(value) => commitAxis(axis as 0 | 1 | 2, value)} />
          </label>
        ))}
      </div>
    </div>
  );
}

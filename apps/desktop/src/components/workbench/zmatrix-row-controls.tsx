import { useRef, useState } from "react";
import type { ZmatrixDefinitionRow } from "../../../../../scripts/zmatrix-document.mjs";
import { INTERNAL_COORDINATE_KINDS, internalCoordinateUnit, type InternalCoordinateKind } from "../../lib/geometry-editing";
import { Plus } from "../ui/app-icons";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { VariableForm, variableToken } from "./zmatrix-definition-controls";

const COLUMN_LABELS: Record<InternalCoordinateKind, string> = { bond: "Bond", angle: "Angle", dihedral: "Dihedral" };
// A new row starts measured from the rows just above it, at ordinary bond, angle and torsion values.
const DEFAULT_VALUES = ["1", "109.47", "180"];
// Value of the "Set by" choice of a literal coordinate; variable names always start with a letter.
const LITERAL = "#value";

type Form = "atom" | "point" | "variable";

/**
 * The toolbar's Add menu: an atom or a reference point as the last row, or a variable.
 * Each opens its form next to the button; a rejected form keeps what was entered.
 */
export function ZmatrixAddMenu({ disabled, rowLabels, variables, suggestedName, onAddRow, onAddVariable }: {
  disabled: boolean; rowLabels: readonly string[]; variables: readonly string[]; suggestedName: string;
  onAddRow: (row: ZmatrixDefinitionRow) => string | null; onAddVariable: (name: string, value: number) => string | null;
}) {
  const [form, setForm] = useState<Form | null>(null);
  // The chosen item hands focus to its form; the closing menu must not take it back.
  const toForm = useRef(false);
  const open = (next: Form) => { toForm.current = true; setForm(next); };
  return (
    <Popover open={form !== null} onOpenChange={(next) => { if (!next) setForm(null); }}>
      <DropdownMenu modal={false}>
        <TooltipProvider><Tooltip><TooltipTrigger asChild>
          <PopoverAnchor asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Add" disabled={disabled}><Plus aria-hidden /></Button>
            </DropdownMenuTrigger>
          </PopoverAnchor>
        </TooltipTrigger><TooltipContent>Add</TooltipContent></Tooltip></TooltipProvider>
        <DropdownMenuContent align="start" onCloseAutoFocus={(event) => { if (toForm.current) event.preventDefault(); toForm.current = false; }}>
          <DropdownMenuItem onSelect={() => open("atom")}>Add atom</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open("point")}>Add reference point</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => open("variable")}>Add variable</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent size="content" align="start" className="zmatrix-add">
        {form === "variable" ? (
          <VariableForm suggestedName={suggestedName} onAdd={(name, value) => {
            const rejected = onAddVariable(name, value);
            if (!rejected) setForm(null);
            return rejected;
          }} />
        ) : form ? (
          <RowForm key={form} referencePoint={form === "point"} rowLabels={rowLabels} variables={variables} onAdd={(row) => {
            const rejected = onAddRow(row);
            if (!rejected) setForm(null);
            return rejected;
          }} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A new last row: its element (X for a reference point), and for each coordinate it has
 * (one per earlier row, at most three) the earlier row it is measured from and its value
 * or a variable that sets it. Every field is checked before the row is added.
 */
function RowForm({ referencePoint, rowLabels, variables, onAdd }: {
  referencePoint: boolean; rowLabels: readonly string[]; variables: readonly string[]; onAdd: (row: ZmatrixDefinitionRow) => string | null;
}) {
  const arity = Math.min(rowLabels.length, 3);
  const [element, setElement] = useState("H");
  const [refs, setRefs] = useState(() => Array.from({ length: arity }, (_, slot) => rowLabels.length - 1 - slot));
  const [bindings, setBindings] = useState(() => Array.from({ length: arity }, () => LITERAL));
  const [values, setValues] = useState(() => DEFAULT_VALUES.slice(0, arity));
  const [error, setError] = useState<string | null>(null);
  const noun = referencePoint ? "reference point" : "atom";
  const submit = () => {
    const symbol = referencePoint ? "X" : element.trim();
    if (!symbol) return "Enter the element of the atom.";
    if (!referencePoint && symbol.toUpperCase() === "X") return "X is a reference point, not an atom. Add it as a reference point.";
    const rowValues: (number | string)[] = [];
    for (let slot = 0; slot < arity; slot++) {
      if (bindings[slot] !== LITERAL) { rowValues.push(bindings[slot]); continue; }
      const value = values[slot].trim() === "" ? Number.NaN : Number(values[slot]);
      if (!Number.isFinite(value)) return `Enter a number for the ${COLUMN_LABELS[INTERNAL_COORDINATE_KINDS[slot]].toLowerCase()}.`;
      rowValues.push(value);
    }
    return onAdd({ element: symbol, refs: [...refs], values: rowValues });
  };
  const set = <T,>(list: T[], slot: number, value: T) => list.map((item, index) => (index === slot ? value : item));
  return (
    <form className="zmatrix-row-form" aria-label={`New ${noun}`} onSubmit={(event) => {
      event.preventDefault();
      setError(submit());
    }}>
      {referencePoint ? null : (
        <label className="zmatrix-row-field">
          <span>Element</span>
          <Input variant="compact" name="element" aria-label="Element" aria-invalid={Boolean(error) || undefined} className="zmatrix-add-element"
            autoComplete="off" spellCheck={false} value={element} onChange={(event) => { setElement(event.target.value); setError(null); }} />
        </label>
      )}
      {INTERNAL_COORDINATE_KINDS.slice(0, arity).map((kind, slot) => {
        const label = COLUMN_LABELS[kind];
        return (
          <div key={kind} className="zmatrix-row-field" role="group" aria-label={label}>
            <span>{label}</span>
            <NativeSelect size="sm" name={`${kind}-reference`} aria-label={`${label} measured from`} value={String(refs[slot])}
              onChange={(event) => { setRefs(set(refs, slot, Number(event.target.value))); setError(null); }}>
              {rowLabels.map((rowLabel, index) => <NativeSelectOption key={index} value={String(index)}>{rowLabel}</NativeSelectOption>)}
            </NativeSelect>
            {variables.length ? (
              <NativeSelect size="sm" name={`${kind}-binding`} aria-label={`${label} set by`} value={bindings[slot]}
                onChange={(event) => { setBindings(set(bindings, slot, event.target.value)); setError(null); }}>
                <NativeSelectOption value={LITERAL}>Value</NativeSelectOption>
                {variables.flatMap((name) => [name, `-${name}`]).map((binding) => (
                  <NativeSelectOption key={binding} value={binding}>{variableToken(binding)}</NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}
            {bindings[slot] === LITERAL ? (
              <Input variant="compact" name={kind} aria-label={`${label}, ${internalCoordinateUnit(kind)}`} aria-invalid={Boolean(error) || undefined}
                className="zmatrix-add-value" inputMode="decimal" autoComplete="off" value={values[slot]}
                onChange={(event) => { setValues(set(values, slot, event.target.value)); setError(null); }} />
            ) : null}
          </div>
        );
      })}
      <Button type="submit" size="xs" variant="secondary" className="zmatrix-row-submit">Add {noun}</Button>
      {error ? <p role="alert" className="geometry-panel-error">{error}</p> : null}
    </form>
  );
}

/**
 * A row's label and its menu: move it one row up or down, or remove it. A reference point
 * is moved and removed like an atom; edits the definition cannot make are reported.
 */
export function ZmatrixRowMenu({ label, referencePoint, index, rowCount, disabled, onMove, onRemove }: {
  label: string; referencePoint: boolean; index: number; rowCount: number; disabled: boolean;
  onMove: (to: number) => void; onRemove: () => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={referencePoint ? "zmatrix-trigger zmatrix-reference" : "zmatrix-trigger"} aria-label={`${label} actions`}
          title={referencePoint ? "Reference point, not an atom" : undefined} disabled={disabled}>{label}</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(index - 1)}>Move up</DropdownMenuItem>
        <DropdownMenuItem disabled={index === rowCount - 1} onSelect={() => onMove(index + 1)}>Move down</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onRemove}>Remove {label}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

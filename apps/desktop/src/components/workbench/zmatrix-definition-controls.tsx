import { useRef, useState } from "react";
import { Button } from "../ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";

// Radio value of a literal coordinate; variable names always start with a letter.
const LITERAL = "#value";

/** A signed variable token as the tables show it. */
export const variableToken = (token: string) => token.replace(/^\+/u, "").replace(/^-/u, "−");

/** A new, initially unused variable: name and value in one undoable edit. */
export function VariableForm({ suggestedName, onAdd }: { suggestedName: string; onAdd: (name: string, value: number) => string | null }) {
  const [name, setName] = useState(suggestedName);
  const [value, setValue] = useState("1");
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <form className="zmatrix-add-form" onSubmit={(event) => {
        event.preventDefault();
        setError(onAdd(name.trim(), value.trim() === "" ? Number.NaN : Number(value)));
      }}>
        <Input variant="compact" aria-label="Variable name" aria-invalid={Boolean(error) || undefined} className="zmatrix-add-name"
          autoComplete="off" spellCheck={false} value={name} onChange={(event) => { setName(event.target.value); setError(null); }} />
        <Input variant="compact" aria-label="Variable value" aria-invalid={Boolean(error) || undefined} className="zmatrix-add-value"
          inputMode="decimal" autoComplete="off" value={value} onChange={(event) => { setValue(event.target.value); setError(null); }} />
        <Button type="submit" size="xs" variant="secondary">Add</Button>
      </form>
      {error ? <p role="alert" className="geometry-panel-error">{error}</p> : null}
    </>
  );
}

/**
 * A variable's name: its menu renames it (in a small form next to the name, since the
 * name column is narrow) or removes it, keeping every coordinate it set.
 */
export function VariableName({ name, disabled, onRename, onRemove }: {
  name: string; disabled: boolean; onRename: (next: string) => string | null; onRemove: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  // Rename hands focus to the form; the closing menu must not take it back to the name.
  const toForm = useRef(false);
  return (
    <Popover open={renaming} onOpenChange={(open) => { setRenaming(open); setError(null); }}>
      <DropdownMenu modal={false}>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <button type="button" className="zmatrix-variable zmatrix-trigger" aria-label={`${name} actions`} title={name} disabled={disabled}>{name}</button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent align="start" onCloseAutoFocus={(event) => { if (toForm.current) event.preventDefault(); toForm.current = false; }}>
          <DropdownMenuItem onSelect={() => { toForm.current = true; setDraft(name); setError(null); setRenaming(true); }}>Rename</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onRemove}>Remove</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent size="content" align="start" className="zmatrix-add">
        <form className="zmatrix-add-form" onSubmit={(event) => {
          event.preventDefault();
          const rejected = onRename(draft.trim());
          if (rejected) setError(rejected);
          else setRenaming(false);
        }}>
          <Input variant="compact" aria-label={`Rename variable ${name}`} aria-invalid={Boolean(error) || undefined} className="zmatrix-add-name"
            autoComplete="off" spellCheck={false} value={draft} disabled={disabled}
            onChange={(event) => { setDraft(event.target.value); setError(null); }} />
          <Button type="submit" size="xs" variant="secondary" disabled={disabled}>Rename</Button>
        </form>
        {error ? <p role="alert" className="geometry-panel-error">{error}</p> : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The reference a coordinate is measured from, and what sets its value. Choosing a row
 * another slot of the same row uses swaps the two; a variable binding stays only while the
 * new references measure the same value.
 */
export function CoordinateDefinition({ label, slot, refs, earlierRows, token, variables, disabled, canBind, onReference, onBind }: {
  label: string; slot: number; refs: readonly number[]; earlierRows: readonly string[];
  token: number | string; variables: readonly string[]; disabled: boolean;
  canBind: (binding: string) => boolean; onReference: (reference: number) => void; onBind: (binding: string | null) => void;
}) {
  const bound = typeof token === "string" ? token.replace(/^\+/u, "") : LITERAL;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="geometry-ref zmatrix-trigger" aria-label={`${label} definition`} disabled={disabled}>{earlierRows[refs[slot]]}</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="zmatrix-definition-menu">
        <DropdownMenuLabel>Measured from</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(refs[slot])} onValueChange={(value) => { if (Number(value) !== refs[slot]) onReference(Number(value)); }}>
          {earlierRows.map((rowLabel, index) => (
            <DropdownMenuRadioItem key={index} value={String(index)}>{rowLabel}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Set by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={bound} onValueChange={(value) => { if (value !== bound) onBind(value === LITERAL ? null : value); }}>
          <DropdownMenuRadioItem value={LITERAL}>Value</DropdownMenuRadioItem>
          <Bindings variables={variables} bound={bound} canBind={canBind} />
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Each variable with either sign, where that signed value is a valid coordinate here
// (a bond to −R when R is negative, say). Checked only while the menu is open.
function Bindings({ variables, bound, canBind }: { variables: readonly string[]; bound: string; canBind: (binding: string) => boolean }) {
  return variables.flatMap((name) => [name, `-${name}`]).filter((binding) => binding === bound || canBind(binding)).map((binding) => (
    <DropdownMenuRadioItem key={binding} value={binding}><span className="zmatrix-variable">{variableToken(binding)}</span></DropdownMenuRadioItem>
  ));
}

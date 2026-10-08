import { Input } from "./ui/input";
import { useEffect, useId, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

import { compileFormula, FORMULA_FUNCTION_NAMES } from "../lib/formula-eval.mjs";
import type { GridColumnChoice } from "./types";

export type CalculatedColumnRequest = {
  documentId: string;
  documentTitle: string;
  // The grid's catalog rather than the filter model, which a paged collection
  // leaves empty - the formula editor had no variable names to validate against.
  columns: GridColumnChoice[];
  // Transform ▸ Treat Logarithmically opens this same dialog with the formula
  // already written, so there is one place a computed column is defined.
  seedFormula?: string;
  seedLabel?: string;
};

export function CalculatedColumnDialog({
  request,
  onDismiss,
  onRun,
}: {
  request: CalculatedColumnRequest | null;
  onDismiss: () => void;
  onRun: (documentId: string, label: string, formula: string) => void;
}) {
  const problemId = useId();
  const [label, setLabel] = useState("");
  const [formula, setFormula] = useState("");
  const seedKey = `${request?.documentId ?? ""}:${request?.seedFormula ?? ""}`;
  useEffect(() => {
    if (!request) return;
    setFormula(request.seedFormula ?? "");
    setLabel(request.seedLabel ?? "");
  }, [seedKey]);

  const numericColumns = useMemo(
    () => (request?.columns ?? []).filter((column) => column.type === "number"),
    [request],
  );

  // Compiling as the user types is what turns a typo into a message next to
  // the field instead of a column full of blanks.
  const compiled = useMemo(() => {
    if (!formula.trim()) return { error: null as string | null, unknown: [] as string[] };
    try {
      const { variables } = compileFormula(formula);
      const known = new Set(numericColumns.map((column) => column.label.toLowerCase()));
      return {
        error: null,
        unknown: variables.filter((name) => !known.has(name.toLowerCase())),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), unknown: [] };
    }
  }, [formula, numericColumns]);

  const ready = Boolean(request)
    && label.trim().length > 0
    && formula.trim().length > 0
    && !compiled.error
    && compiled.unknown.length === 0;

  const insert = (text: string) => setFormula((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${text}`);

  const problem = compiled.error || (compiled.unknown.length
    ? `No numeric column named ${compiled.unknown.map(name => `“${name}”`).join(", ")}.`
    : null);

  return (
    <Dialog open={request !== null} onOpenChange={open => { if (!open) onDismiss(); }}>
      <DialogContent variant="form" size="compact" className="overscroll-contain">
        <form className="flex min-w-0 flex-col gap-4" onSubmit={event => {
          event.preventDefault();
          if (!request || !ready) return;
          onRun(request.documentId, label.trim(), formula.trim());
          onDismiss();
        }}>
          <DialogHeader>
            <DialogTitle>Add calculated values</DialogTitle>
            <DialogDescription className="sr-only">Define a column using a formula.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-2 text-xs"><span>New column name</span>
            <Input variant="field" name="label" autoComplete="off" value={label} maxLength={80}
              placeholder="Ligand efficiency" onChange={event => setLabel(event.target.value)} />
          </label>
          <label className="flex flex-col gap-2 text-xs"><span>Formula</span>
            <Textarea name="formula" autoComplete="off" value={formula} rows={3} spellCheck={false}
              className="max-h-48 resize-y font-mono" placeholder="1.37 * [pIC50] / [HeavyAtoms]"
              aria-invalid={Boolean(problem)} aria-describedby={problem ? problemId : undefined}
              onChange={event => setFormula(event.target.value)} />
          </label>
          {problem && <p id={problemId} className="break-words text-sm text-(--color-text-danger)" role="alert">{problem}</p>}
          {numericColumns.length > 0 && <fieldset className="min-w-0">
            <legend className="mb-2 text-xs">Columns</legend>
            <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto overscroll-contain">
              {numericColumns.map(column => <Button key={column.id} type="button" variant="secondary" size="xs"
                className="max-w-full [content-visibility:auto] [contain-intrinsic-size:auto_80px_auto_24px]" onClick={() => insert(`[${column.label}]`)}>
                <span className="truncate">{column.label}</span>
              </Button>)}
            </div>
          </fieldset>}
          <fieldset className="min-w-0">
            <legend className="mb-2 text-xs">Functions</legend>
            <div className="flex flex-wrap gap-1">
              {FORMULA_FUNCTION_NAMES.map(name => <Button key={name} type="button" variant="secondary" size="xs"
                onClick={() => insert(`${name}(`)}>{name}</Button>)}
            </div>
          </fieldset>
          <p className="text-xs text-(--color-text-secondary)">Missing inputs leave the result empty.</p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onDismiss}>Cancel</Button>
            <Button type="submit" disabled={!ready}>Add column</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

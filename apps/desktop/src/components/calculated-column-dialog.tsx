import { useEffect, useMemo, useState } from "react";
import { Dialog } from "radix-ui";

import { compileFormula, FORMULA_FUNCTION_NAMES } from "../lib/formula-eval.mjs";
import type { GridColumnChoice } from "./types";
import { useAppShellPortalContainer } from "./ui/portal-container";
import { CloseIcon } from "./close-icon";

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
  const portalContainer = useAppShellPortalContainer();
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

  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog calculated-column-dialog" aria-describedby="calculated-column-body">
          <div className="radix-dialog-header">
            <Dialog.Title>Add Calculated Values</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Close calculated values">
                <CloseIcon size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div id="calculated-column-body" className="radix-dialog-body">
            <label className="calculated-column-field">
              <span>New column name</span>
              <input
                type="text"
                value={label}
                maxLength={80}
                placeholder="Ligand efficiency"
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <label className="calculated-column-field">
              <span>Formula</span>
              <textarea
                value={formula}
                rows={3}
                spellCheck={false}
                placeholder="1.37 * [pIC50] / [HeavyAtoms]"
                onChange={(event) => setFormula(event.target.value)}
              />
            </label>
            {compiled.error ? (
              <div className="calculated-column-problem">{compiled.error}</div>
            ) : compiled.unknown.length > 0 ? (
              <div className="calculated-column-problem">
                {`No numeric column named ${compiled.unknown.map((name) => `"${name}"`).join(", ")}.`}
              </div>
            ) : null}
            <div className="calculated-column-help">
              <div className="calculated-column-help-title">Columns</div>
              <div className="calculated-column-chips">
                {numericColumns.length === 0
                  ? <span className="calculated-column-empty">This collection has no numeric columns yet.</span>
                  : numericColumns.map((column) => (
                    <button
                      key={column.id}
                      type="button"
                      className="calculated-column-chip"
                      onClick={() => insert(`[${column.label}]`)}
                    >
                      {column.label}
                    </button>
                  ))}
              </div>
              <div className="calculated-column-help-title">Functions</div>
              <div className="calculated-column-chips">
                {FORMULA_FUNCTION_NAMES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="calculated-column-chip"
                    onClick={() => insert(`${name}(`)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <p className="calculated-column-note">
                Operators + − * / ^ and comparisons work as usual. A row missing any input is left empty.
              </p>
            </div>
          </div>
          <div className="radix-dialog-footer calculate-properties-footer">
            <span className="calculate-properties-count">
              {ready ? "Ready" : "Name the column and enter a formula"}
            </span>
            <div className="calculate-properties-actions">
              <Dialog.Close asChild>
                <button type="button" className="dock-action">Cancel</button>
              </Dialog.Close>
              <button
                type="button"
                className="dock-action calculate-properties-run"
                disabled={!ready}
                onClick={() => {
                  if (!request || !ready) return;
                  onRun(request.documentId, label.trim(), formula.trim());
                  onDismiss();
                }}
              >
                Add Column
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

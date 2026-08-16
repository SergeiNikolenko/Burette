import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";

import type { GridColumnChoice } from "./types";
import { useAppShellPortalContainer } from "./ui/portal-container";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { CloseIcon } from "./close-icon";

export type SetValueRangeRequest = {
  documentId: string;
  documentTitle: string;
  columns: GridColumnChoice[];
};

function boundProblem(value: string) {
  const text = value.trim();
  if (!text) return null;
  return Number.isFinite(Number(text)) ? null : `${text} is not a number.`;
}

// DataWarrior's Set Value Range. The column keeps every value it has; what
// changes is the range the table and the analyses see, so leaving a side blank
// means "no limit there" and clearing both takes the limit off the column.
export function SetValueRangeDialog({
  request,
  onDismiss,
  onRun,
}: {
  request: SetValueRangeRequest | null;
  onDismiss: () => void;
  onRun: (documentId: string, column: { id: string; label: string }, min: string, max: string) => void;
}) {
  const portalContainer = useAppShellPortalContainer();
  const columns = request?.columns ?? [];
  const [columnId, setColumnId] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");

  useEffect(() => {
    if (!request) return;
    setColumnId(request.columns[0]?.id ?? "");
    setMin("");
    setMax("");
  }, [request?.documentId]);

  const column = columns.find((candidate) => candidate.id === columnId) ?? null;
  const problem = boundProblem(min)
    ?? boundProblem(max)
    ?? (min.trim() && max.trim() && Number(min) > Number(max)
      ? "The lower limit cannot exceed the upper one."
      : null);
  const ready = Boolean(request) && Boolean(column) && !problem;
  const clearing = !min.trim() && !max.trim();

  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog calculated-column-dialog" aria-describedby="set-value-range-body">
          <div className="radix-dialog-header">
            <Dialog.Title>Set Value Range</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Close value range">
                <CloseIcon size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div id="set-value-range-body" className="radix-dialog-body">
            <label className="calculated-column-field">
              <span>Column</span>
              <NativeSelect size="sm" value={columnId} onChange={(event) => setColumnId(event.target.value)}>
                {columns.map((candidate) => (
                  <NativeSelectOption key={candidate.id} value={candidate.id}>{candidate.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="calculated-column-field">
              <span>Lower limit</span>
              <input
                type="text"
                value={min}
                inputMode="decimal"
                placeholder="no limit"
                onChange={(event) => setMin(event.target.value)}
              />
            </label>
            <label className="calculated-column-field">
              <span>Upper limit</span>
              <input
                type="text"
                value={max}
                inputMode="decimal"
                placeholder="no limit"
                onChange={(event) => setMax(event.target.value)}
              />
            </label>
            {problem ? <div className="calculated-column-problem">{problem}</div> : null}
            <p className="calculated-column-note">
              Values outside the range are read at the limit by the table, the filters and every
              analysis. Nothing is deleted, and Undo takes the column back.
            </p>
          </div>
          <div className="radix-dialog-footer calculate-properties-footer">
            <span className="calculate-properties-count">
              {clearing ? "Both limits blank clears the range" : "Blank means no limit on that side"}
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
                  if (!request || !column || !ready) return;
                  onRun(request.documentId, { id: column.id, label: column.label }, min.trim(), max.trim());
                  onDismiss();
                }}
              >
                {clearing ? "Clear" : "Apply"}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

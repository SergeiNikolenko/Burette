import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";

import type { GridColumnChoice } from "./types";
import { useAppShellPortalContainer } from "./ui/portal-container";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { CloseIcon } from "./close-icon";

export type SplitValueRowsRequest = {
  documentId: string;
  documentTitle: string;
  columns: GridColumnChoice[];
};

// DataWarrior's Split Multiple Value Rows. A cell that holds several values
// separated by one character becomes one row per value; every other column is
// copied, so a molecule measured three times becomes three comparable rows.
export function SplitValueRowsDialog({
  request,
  onDismiss,
  onRun,
}: {
  request: SplitValueRowsRequest | null;
  onDismiss: () => void;
  onRun: (documentId: string, column: { id: string; label: string }, delimiter: string) => void;
}) {
  const portalContainer = useAppShellPortalContainer();
  const columns = request?.columns ?? [];
  const [columnId, setColumnId] = useState("");
  const [delimiter, setDelimiter] = useState(";");

  useEffect(() => {
    if (!request) return;
    setColumnId(request.columns[0]?.id ?? "");
    setDelimiter(";");
  }, [request?.documentId]);

  const column = columns.find((candidate) => candidate.id === columnId) ?? null;
  const ready = Boolean(request) && Boolean(column) && delimiter.length > 0;

  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog calculated-column-dialog" aria-describedby="split-value-rows-body">
          <div className="radix-dialog-header">
            <Dialog.Title>Split Multiple Value Rows</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Close split rows">
                <CloseIcon size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div id="split-value-rows-body" className="radix-dialog-body">
            <label className="calculated-column-field">
              <span>Column</span>
              <NativeSelect size="sm" value={columnId} onChange={(event) => setColumnId(event.target.value)}>
                {columns.map((candidate) => (
                  <NativeSelectOption key={candidate.id} value={candidate.id}>{candidate.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="calculated-column-field">
              <span>Separator</span>
              <input
                type="text"
                value={delimiter}
                maxLength={8}
                spellCheck={false}
                placeholder=";"
                onChange={(event) => setDelimiter(event.target.value)}
              />
            </label>
            <p className="calculated-column-note">
              A row whose cell holds several values becomes one row per value; the other columns are
              copied. The row that was there keeps the first value, so everything already computed
              for it stays attached. Undo takes the split back.
            </p>
          </div>
          <div className="radix-dialog-footer calculate-properties-footer">
            <span className="calculate-properties-count">
              {ready ? `Splitting on "${delimiter}"` : "Pick a column and a separator"}
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
                  onRun(request.documentId, { id: column.id, label: column.label }, delimiter);
                  onDismiss();
                }}
              >
                Split
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Dialog } from "radix-ui";

import { useAppShellPortalContainer } from "./ui/portal-container";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { CloseIcon } from "./close-icon";
import type { GridColumnChoice } from "./types";

export type MergeColumnsRequest = {
  documentId: string;
  documentTitle: string;
  // The grid's own catalog: a paged collection leaves the filter model empty,
  // which used to make this dialog offer nothing at all on the desktop.
  columns: GridColumnChoice[];
};

// DataWarrior's Merge Columns. Every column is offered, not only the numeric
// ones: joining a name with an identifier is the common case, and the merge is
// over what the cells display.
export function MergeColumnsDialog({
  request,
  onDismiss,
  onRun,
}: {
  request: MergeColumnsRequest | null;
  onDismiss: () => void;
  onRun: (
    documentId: string,
    label: string,
    separator: string,
    columns: Array<{ id: string; label: string }>,
  ) => void;
}) {
  const portalContainer = useAppShellPortalContainer();
  const columns = useMemo(() => request?.columns ?? [], [request]);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [separator, setSeparator] = useState(" ");
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!request) return;
    setFirst(columns[0]?.id ?? "");
    setSecond(columns[1]?.id ?? "");
    setSeparator(" ");
    setLabel("");
  }, [request?.documentId]);

  const chosen = [first, second]
    .map((id) => columns.find((column) => column.id === id))
    .filter((column): column is NonNullable<typeof column> => Boolean(column));
  const duplicate = first !== "" && first === second;
  const suggestedLabel = chosen.map((column) => column.label).join(" + ");
  const effectiveLabel = label.trim() || suggestedLabel;
  const canRun = chosen.length === 2 && !duplicate && effectiveLabel.length > 0;

  return (
    <Dialog.Root open={Boolean(request)} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog calculated-column-dialog" aria-describedby="merge-columns-body">
          <div className="radix-dialog-header">
            <Dialog.Title>Merge Columns</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Close merge columns">
                <CloseIcon size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div id="merge-columns-body" className="radix-dialog-body">
            <p className="calculate-properties-target">
              Joins two columns of <strong>{request?.documentTitle}</strong> into a new one.
            </p>
            <label className="calculated-column-field">
              <span>First column</span>
              <NativeSelect size="sm" value={first} onChange={(event) => setFirst(event.target.value)}>
                {columns.map((column) => (
                  <NativeSelectOption key={column.id} value={column.id}>{column.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="calculated-column-field">
              <span>Second column</span>
              <NativeSelect size="sm" value={second} onChange={(event) => setSecond(event.target.value)}>
                {columns.map((column) => (
                  <NativeSelectOption key={column.id} value={column.id}>{column.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            {duplicate ? <div className="calculated-column-problem">Pick two different columns.</div> : null}
            <label className="calculated-column-field">
              <span>Separator</span>
              <input type="text" value={separator} onChange={(event) => setSeparator(event.target.value)} placeholder="space" />
            </label>
            <label className="calculated-column-field">
              <span>New column</span>
              <input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={suggestedLabel || "Merged"}
              />
            </label>
            <p className="calculated-column-note">
              Joins the displayed values as text.
            </p>
          </div>
          <div className="radix-dialog-footer calculate-properties-footer">
            <div className="calculate-properties-actions">
              <Dialog.Close asChild>
                <button type="button" className="dock-action">Cancel</button>
              </Dialog.Close>
              <button
                type="button"
                className="dock-action calculate-properties-run"
                disabled={!canRun}
                onClick={() => {
                  if (!request || !canRun) return;
                  onRun(
                    request.documentId,
                    effectiveLabel,
                    separator,
                    chosen.map((column) => ({ id: column.id, label: column.label })),
                  );
                  onDismiss();
                }}
              >
                Merge
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

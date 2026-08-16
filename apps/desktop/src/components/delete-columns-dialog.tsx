import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";

import type { GridColumnChoice } from "./types";
import { useAppShellPortalContainer } from "./ui/portal-container";
import { CloseIcon } from "./close-icon";

export type DeleteColumnsRequest = {
  documentId: string;
  documentTitle: string;
  columns: GridColumnChoice[];
};

// Delete Columns removes data columns the file brought along. It is a grid
// edit like deleting rows: the collection on disk is untouched until the next
// save, and one Undo entry brings the columns back whole.
export function DeleteColumnsDialog({
  request,
  onDismiss,
  onRun,
}: {
  request: DeleteColumnsRequest | null;
  onDismiss: () => void;
  onRun: (documentId: string, columnKeys: string[]) => void;
}) {
  const portalContainer = useAppShellPortalContainer();
  const columns = request?.columns ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!request) return;
    setSelected(new Set());
  }, [request?.documentId]);

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog calculated-column-dialog" aria-describedby="delete-columns-body">
          <div className="radix-dialog-header">
            <Dialog.Title>Delete Columns</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Close delete columns">
                <CloseIcon size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div id="delete-columns-body" className="radix-dialog-body">
            <div className="calculate-properties-groups" role="group" aria-label="Columns to delete">
              {columns.map((candidate) => (
                <label key={candidate.id} className="calculate-properties-option">
                  <input
                    type="checkbox"
                    checked={selected.has(candidate.id)}
                    onChange={() => toggle(candidate.id)}
                  />
                  <span>{candidate.label}</span>
                </label>
              ))}
            </div>
            <p className="calculated-column-note">
              The columns disappear from the table and from every save until Undo. Structure,
              name and computed columns stay.
            </p>
          </div>
          <div className="radix-dialog-footer calculate-properties-footer">
            <span className="calculate-properties-count">
              {selected.size > 0
                ? `${selected.size.toLocaleString()} column${selected.size === 1 ? "" : "s"} selected`
                : "Nothing selected"}
            </span>
            <div className="calculate-properties-actions">
              <Dialog.Close asChild>
                <button type="button" className="dock-action">Cancel</button>
              </Dialog.Close>
              <button
                type="button"
                className="dock-action calculate-properties-run"
                disabled={selected.size === 0}
                onClick={() => {
                  if (!request || selected.size === 0) return;
                  onRun(request.documentId, [...selected]);
                  onDismiss();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

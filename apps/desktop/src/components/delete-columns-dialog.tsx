import { Checkbox } from "./ui/checkbox";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";

import type { GridColumnChoice } from "./types";

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
    <Dialog open={request !== null} onOpenChange={open => { if (!open) onDismiss(); }}>
      <DialogContent variant="form" size="compact">
        <DialogHeader>
          <DialogTitle>Delete columns</DialogTitle>
          <DialogDescription className="sr-only">Choose columns to remove from the table.</DialogDescription>
        </DialogHeader>
        <div className="max-h-60 overflow-y-auto overscroll-contain rounded-2xl border border-(--color-border) px-5 py-4" role="group" aria-label="Columns to delete">
          {columns.map(candidate => (
            <label key={candidate.id} className="flex min-w-0 items-center gap-2 py-1 text-sm [content-visibility:auto] [contain-intrinsic-size:auto_28px]">
              <Checkbox checked={selected.has(candidate.id)} onCheckedChange={() => toggle(candidate.id)} />
              <span className="min-w-0 break-words">{candidate.label}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-(--color-text-secondary)">The file on disk changes only when you save.</p>
        <DialogFooter className="gap-2">
          <span className="mr-auto text-xs text-(--color-text-secondary)" role="status">{selected.size.toLocaleString()} selected</span>
          <Button type="button" variant="ghost" onClick={onDismiss}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={selected.size === 0} onClick={() => {
            if (!request || selected.size === 0) return;
            onRun(request.documentId, [...selected]);
            onDismiss();
          }}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

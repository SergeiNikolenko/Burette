import { Input } from "./ui/input";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";

import type { GridColumnChoice } from "./types";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

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
    <Dialog open={request !== null} onOpenChange={open => { if (!open) onDismiss(); }}>
      <DialogContent variant="form" size="compact">
        <form className="flex min-w-0 flex-col gap-4" onSubmit={event => {
          event.preventDefault();
          if (!request || !column || !ready) return;
          onRun(request.documentId, { id: column.id, label: column.label }, delimiter);
          onDismiss();
        }}>
          <DialogHeader>
            <DialogTitle>Split multiple value rows</DialogTitle>
            <DialogDescription className="sr-only">Creates one row per value, copying the other columns.</DialogDescription>
          </DialogHeader>
          <label className="flex min-w-0 flex-col gap-2 text-xs"><span>Column</span>
            <NativeSelect name="column" className="w-full" value={columnId} onChange={event => setColumnId(event.target.value)}>
              {columns.map(candidate => <NativeSelectOption key={candidate.id} value={candidate.id}>{candidate.label}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-2 text-xs"><span>Separator</span>
            <Input variant="field" name="separator" autoComplete="off" value={delimiter} maxLength={8} spellCheck={false}
              onChange={event => setDelimiter(event.target.value)} />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onDismiss}>Cancel</Button>
            <Button type="submit" disabled={!ready}>Split</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

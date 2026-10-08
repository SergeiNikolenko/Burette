import { Input } from "./ui/input";
import { useEffect, useId, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";

import type { GridColumnChoice } from "./types";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

export type BinsColumnRequest = {
  documentId: string;
  documentTitle: string;
  columns: GridColumnChoice[];
};

// DataWarrior's Bins From Numbers. One number decides everything: the bin
// width. Bins are anchored at round multiples of it, so the same width always
// produces the same intervals no matter what the column's minimum happens
// to be.
export function BinsColumnDialog({
  request,
  onDismiss,
  onRun,
}: {
  request: BinsColumnRequest | null;
  onDismiss: () => void;
  onRun: (documentId: string, column: { id: string; label: string }, binWidth: number) => void;
}) {
  const problemId = useId();
  const columns = request?.columns ?? [];
  const [columnId, setColumnId] = useState("");
  const [width, setWidth] = useState("1");

  useEffect(() => {
    if (!request) return;
    setColumnId(request.columns[0]?.id ?? "");
    setWidth("1");
  }, [request?.documentId]);

  const column = columns.find((candidate) => candidate.id === columnId) ?? null;
  const parsedWidth = Number(width.trim());
  const problem = !width.trim()
    ? null
    : !Number.isFinite(parsedWidth)
      ? `${width.trim()} is not a number.`
      : parsedWidth <= 0
        ? "The bin width has to be positive."
        : null;
  const ready = Boolean(request) && Boolean(column) && width.trim() !== "" && !problem;

  return (
    <Dialog open={request !== null} onOpenChange={open => { if (!open) onDismiss(); }}>
      <DialogContent variant="form" size="compact">
        <form className="flex min-w-0 flex-col gap-4" onSubmit={event => {
          event.preventDefault();
          if (!request || !column || !ready) return;
          onRun(request.documentId, { id: column.id, label: column.label }, parsedWidth);
          onDismiss();
        }}>
          <DialogHeader>
            <DialogTitle>Bins from numbers</DialogTitle>
            <DialogDescription className="sr-only">Group numeric values into equal-width intervals.</DialogDescription>
          </DialogHeader>
          <label className="flex min-w-0 flex-col gap-2 text-xs"><span>Column</span>
            <NativeSelect name="column" className="w-full" value={columnId} onChange={event => setColumnId(event.target.value)}>
              {columns.map(candidate => <NativeSelectOption key={candidate.id} value={candidate.id}>{candidate.label}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-2 text-xs"><span>Bin width</span>
            <Input variant="field" name="width" autoComplete="off" spellCheck={false} value={width} inputMode="decimal"
              aria-invalid={Boolean(problem)} aria-describedby={problem ? problemId : undefined}
              onChange={event => setWidth(event.target.value)} />
          </label>
          {problem && <p id={problemId} className="break-words text-sm text-(--color-text-danger)" role="alert">{problem}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onDismiss}>Cancel</Button>
            <Button type="submit" disabled={!ready}>Add column</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

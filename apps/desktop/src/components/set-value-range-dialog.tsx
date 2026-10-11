import { Input } from "./ui/input";
import { useEffect, useId, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";

import type { GridColumnChoice } from "./types";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

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
  const problemId = useId();
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
  const minProblem = boundProblem(min);
  const maxProblem = boundProblem(max);
  const reversed = Boolean(min.trim() && max.trim() && Number(min) > Number(max));
  const problem = minProblem ?? maxProblem ?? (reversed ? "The lower limit cannot exceed the upper one." : null);
  const ready = Boolean(request) && Boolean(column) && !problem;
  const clearing = !min.trim() && !max.trim();

  return (
    <Dialog open={request !== null} onOpenChange={open => { if (!open) onDismiss(); }}>
      <DialogContent variant="form" size="compact">
        <form className="flex min-w-0 flex-col gap-4" onSubmit={event => {
          event.preventDefault();
          if (!request || !column || !ready) return;
          onRun(request.documentId, { id: column.id, label: column.label }, min.trim(), max.trim());
          onDismiss();
        }}>
          <DialogHeader>
            <DialogTitle>Set value range</DialogTitle>
            <DialogDescription className="sr-only">Set or clear the limits for a column.</DialogDescription>
          </DialogHeader>
          <label className="flex min-w-0 flex-col gap-2 text-xs"><span>Column</span>
            <NativeSelect name="column" className="w-full" value={columnId} onChange={event => setColumnId(event.target.value)}>
              {columns.map(candidate => <NativeSelectOption key={candidate.id} value={candidate.id}>{candidate.label}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-2 text-xs"><span>Lower limit</span>
            <Input variant="field" name="min" autoComplete="off" spellCheck={false} value={min} inputMode="decimal" placeholder="No limit"
              aria-invalid={Boolean(minProblem || reversed)} aria-describedby={minProblem || reversed ? problemId : undefined}
              onChange={event => setMin(event.target.value)} />
          </label>
          <label className="flex flex-col gap-2 text-xs"><span>Upper limit</span>
            <Input variant="field" name="max" autoComplete="off" spellCheck={false} value={max} inputMode="decimal" placeholder="No limit"
              aria-invalid={Boolean(maxProblem || reversed)} aria-describedby={maxProblem || reversed ? problemId : undefined}
              onChange={event => setMax(event.target.value)} />
          </label>
          {problem && <p id={problemId} className="break-words text-sm text-(--color-text-danger)" role="alert">{problem}</p>}
          <p className="text-xs text-(--color-text-secondary)">Values outside the range use the nearest limit.</p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onDismiss}>Cancel</Button>
            <Button type="submit" disabled={!ready}>{clearing ? "Clear" : "Apply"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

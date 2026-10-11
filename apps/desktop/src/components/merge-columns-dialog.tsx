import { Input } from "./ui/input";
import { useEffect, useId, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";

import { NativeSelect, NativeSelectOption } from "./ui/native-select";
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
  const problemId = useId();
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
    <Dialog open={Boolean(request)} onOpenChange={open => { if (!open) onDismiss(); }}>
      <DialogContent variant="form" size="compact">
        <form className="flex min-w-0 flex-col gap-4" onSubmit={event => {
          event.preventDefault();
          if (!request || !canRun) return;
          onRun(request.documentId, effectiveLabel, separator, chosen.map(column => ({ id: column.id, label: column.label })));
          onDismiss();
        }}>
          <DialogHeader>
            <DialogTitle>Merge columns</DialogTitle>
            <DialogDescription className="sr-only">Join the displayed values from two columns.</DialogDescription>
          </DialogHeader>
          <label className="flex min-w-0 flex-col gap-2 text-xs"><span>First column</span>
            <NativeSelect name="first" className="w-full" value={first} onChange={event => setFirst(event.target.value)}
              aria-invalid={duplicate} aria-describedby={duplicate ? problemId : undefined}>
              {columns.map(column => <NativeSelectOption key={column.id} value={column.id}>{column.label}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label className="flex min-w-0 flex-col gap-2 text-xs"><span>Second column</span>
            <NativeSelect name="second" className="w-full" value={second} onChange={event => setSecond(event.target.value)}
              aria-invalid={duplicate} aria-describedby={duplicate ? problemId : undefined}>
              {columns.map(column => <NativeSelectOption key={column.id} value={column.id}>{column.label}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          {duplicate && <p id={problemId} className="text-sm text-(--color-text-danger)" role="alert">Pick two different columns.</p>}
          <label className="flex flex-col gap-2 text-xs"><span>Separator</span>
            <Input variant="field" name="separator" autoComplete="off" spellCheck={false} value={separator}
              onChange={event => setSeparator(event.target.value)} />
          </label>
          <label className="flex flex-col gap-2 text-xs"><span>New column</span>
            <Input variant="field" name="label" autoComplete="off" value={label} onChange={event => setLabel(event.target.value)}
              placeholder={suggestedLabel || "Merged"} />
          </label>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onDismiss}>Cancel</Button>
            <Button type="submit" disabled={!canRun}>Merge</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

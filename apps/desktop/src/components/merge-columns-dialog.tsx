import { useEffect, useMemo, useState } from "react";
import { Dialog } from "radix-ui";

import { useAppShellPortalContainer } from "./ui/portal-container";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content merge-columns-dialog">
          <Dialog.Title>Merge columns</Dialog.Title>
          <Dialog.Description>
            {request ? `Join two columns of ${request.documentTitle} into a new one.` : ""}
          </Dialog.Description>
          <label className="merge-columns-field">
            <span>First column</span>
            <NativeSelect size="sm" value={first} onChange={(event) => setFirst(event.target.value)}>
              {columns.map((column) => (
                <NativeSelectOption key={column.id} value={column.id}>{column.label}</NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="merge-columns-field">
            <span>Second column</span>
            <NativeSelect size="sm" value={second} onChange={(event) => setSecond(event.target.value)}>
              {columns.map((column) => (
                <NativeSelectOption key={column.id} value={column.id}>{column.label}</NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="merge-columns-field">
            <span>Separator</span>
            <Input value={separator} onChange={(event) => setSeparator(event.target.value)} placeholder="space" />
          </label>
          <label className="merge-columns-field">
            <span>New column</span>
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={suggestedLabel || "Merged"}
            />
          </label>
          {duplicate ? <p className="merge-columns-error">Pick two different columns.</p> : null}
          <div className="dialog-actions">
            <Button type="button" variant="secondary" size="sm" onClick={onDismiss}>Cancel</Button>
            <Button
              type="button"
              size="sm"
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
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

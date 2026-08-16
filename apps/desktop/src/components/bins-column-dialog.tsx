import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";

import type { GridColumnChoice } from "./types";
import { useAppShellPortalContainer } from "./ui/portal-container";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { CloseIcon } from "./close-icon";

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
  const portalContainer = useAppShellPortalContainer();
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
    <Dialog.Root open={request !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog calculated-column-dialog" aria-describedby="bins-column-body">
          <div className="radix-dialog-header">
            <Dialog.Title>Bins From Numbers</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Close bins">
                <CloseIcon size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div id="bins-column-body" className="radix-dialog-body">
            <label className="calculated-column-field">
              <span>Column</span>
              <NativeSelect size="sm" value={columnId} onChange={(event) => setColumnId(event.target.value)}>
                {columns.map((candidate) => (
                  <NativeSelectOption key={candidate.id} value={candidate.id}>{candidate.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="calculated-column-field">
              <span>Bin width</span>
              <input
                type="text"
                value={width}
                inputMode="decimal"
                onChange={(event) => setWidth(event.target.value)}
              />
            </label>
            {problem ? <div className="calculated-column-problem">{problem}</div> : null}
            <p className="calculated-column-note">
              Every value lands in the interval it belongs to - a width of 1 turns 7.3 into
              [7 - 8). The bin floor rides along invisibly, so the column sorts numerically.
            </p>
          </div>
          <div className="radix-dialog-footer calculate-properties-footer">
            <span className="calculate-properties-count">
              {column ? `Binning ${column.label}` : "Pick a numeric column"}
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
                  onRun(request.documentId, { id: column.id, label: column.label }, parsedWidth);
                  onDismiss();
                }}
              >
                Add Column
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

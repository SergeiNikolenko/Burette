import type { ComponentType } from "react";
import { closeWorkbenchDialog, useWorkbenchDialogRequest, type WorkbenchDialogKind } from "../../lib/workbench/dialog-store";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { MergeForm } from "./merge-form";
import { PivotForm } from "./pivot-form";
import { UnpivotForm } from "./unpivot-form";
import { useGridTable, type GridTableSnapshot } from "./use-grid-table";

type FormProps = { documentId: string; snapshot: GridTableSnapshot; onDone: () => void };

// DataWarrior's New from Pivoting, New from Reverse-Pivoting and Merge File.
// Each one rewrites the open collection through the grid's edit layer instead
// of opening a second document: one Undo entry takes the table back.
const COMMANDS: Partial<Record<WorkbenchDialogKind, { title: string; description: string; Form: ComponentType<FormProps> }>> = {
  pivot: { title: "Pivot", description: "Turns the values of one column into columns, one row per key.", Form: PivotForm },
  unpivot: { title: "Unpivot", description: "Turns columns into rows, one row per value.", Form: UnpivotForm },
  "merge-by-key": { title: "Merge file by key", description: "Adds the columns of another file to the rows with the same key.", Form: MergeForm },
};

/** Collection ▸ Pivot, Unpivot and Merge File by Key, from the menu or the command palette. */
export function DataShapingDialogHost() {
  const request = useWorkbenchDialogRequest();
  const command = request ? COMMANDS[request.kind] : undefined;
  const document = command && request?.document?.renderer === "grid2d" ? request.document : null;
  return (
    <Dialog open={Boolean(document)} onOpenChange={(open) => { if (!open && document) closeWorkbenchDialog(); }}>
      {command && document ? (
        <DialogContent variant="form" size="default">
          <DialogHeader>
            <DialogTitle>{command.title}</DialogTitle>
            <DialogDescription className="sr-only">{command.description}</DialogDescription>
          </DialogHeader>
          <DataShapingBody key={`${request?.kind}:${document.id}`} documentId={document.id} Form={command.Form} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function DataShapingBody({ documentId, Form }: { documentId: string; Form: ComponentType<FormProps> }) {
  const { snapshot, error } = useGridTable(documentId);
  if (error) return <p className="break-words text-sm text-(--color-text-danger)" role="alert">{error}</p>;
  if (!snapshot) return <p className="text-sm text-(--color-text-secondary)" role="status">Reading the collection…</p>;
  if (snapshot.rows.length === 0) return <p className="text-sm" role="status">The collection has no rows.</p>;
  return <Form documentId={documentId} snapshot={snapshot} onDone={closeWorkbenchDialog} />;
}

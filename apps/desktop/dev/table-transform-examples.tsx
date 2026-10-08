import { useState } from "react";
import { SetValueRangeDialog } from "@/components/set-value-range-dialog";
import { SplitValueRowsDialog } from "@/components/split-value-rows-dialog";
import { BinsColumnDialog } from "@/components/bins-column-dialog";
import { DeleteColumnsDialog } from "@/components/delete-columns-dialog";
import { Button } from "@/components/ui/button";
import type { GridColumnChoice } from "@/components/types";

const columns: GridColumnChoice[] = [{ id: "mass", label: "Mass", type: "number", kind: "property" }, { id: "activity", label: "Activity", type: "number", kind: "property" }];
const request = { documentId: "series", documentTitle: "Series", columns };

// Production dialogs with callback-only results. No collection or file is changed.
export function TableTransformExamples() {
  const [open, setOpen] = useState<"range" | "split" | "bins" | "delete" | null>(null);
  const [result, setResult] = useState("");
  return <section aria-label="Table transformations" className="flex flex-wrap items-center gap-2">
    <Button variant="secondary" onClick={() => setOpen("range")}>Set value range</Button>
    <Button variant="secondary" onClick={() => setOpen("split")}>Split rows</Button>
    <Button variant="secondary" onClick={() => setOpen("bins")}>Bins from numbers</Button>
    <Button variant="secondary" onClick={() => setOpen("delete")}>Delete columns</Button>
    {result && <output className="w-full text-sm">{result}</output>}
    <SetValueRangeDialog request={open === "range" ? request : null} onDismiss={() => setOpen(null)}
      onRun={(_id, column, min, max) => setResult(`${column.label}: ${min || "unbounded"} to ${max || "unbounded"}`)} />
    <SplitValueRowsDialog request={open === "split" ? request : null} onDismiss={() => setOpen(null)}
      onRun={(_id, column, delimiter) => setResult(`${column.label}: split on ${JSON.stringify(delimiter)}`)} />
    <BinsColumnDialog request={open === "bins" ? request : null} onDismiss={() => setOpen(null)}
      onRun={(_id, column, width) => setResult(`${column.label}: bin width ${width}`)} />
    <DeleteColumnsDialog request={open === "delete" ? request : null} onDismiss={() => setOpen(null)}
      onRun={(_id, ids) => setResult(`Selected columns: ${ids.join(", ")}`)} />
  </section>;
}

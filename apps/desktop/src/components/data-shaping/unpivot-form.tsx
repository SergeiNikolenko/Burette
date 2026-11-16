import { useMemo, useState } from "react";
import { columnKey, isDataColumn, unpivotRowEdits } from "../../lib/grid-reshape";
import { applyGridRowEdits } from "../../lib/grid-table-bridge";
import { unpivotTable } from "../../lib/table-shaping";
import { Button } from "../ui/button";
import { DialogFooter } from "../ui/dialog";
import { Input } from "../ui/input";
import { ColumnChecklist, Outcome, plural } from "./fields";
import type { GridTableSnapshot } from "./use-grid-table";

export function UnpivotForm({ documentId, snapshot, onDone }: { documentId: string; snapshot: GridTableSnapshot; onDone: () => void }) {
  const dataColumns = useMemo(() => snapshot.columns.filter(isDataColumn), [snapshot.columns]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [categoryName, setCategoryName] = useState("Category");
  const [valueName, setValueName] = useState("Value");
  const [separator, setSeparator] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => ({
    // Rows are written in the table's column order, whatever order the boxes were ticked in.
    columns: dataColumns.filter((column) => selected.has(column.id)).map(columnKey),
    categoryColumn: categoryName.trim(),
    valueColumn: valueName.trim(),
  }), [categoryName, dataColumns, selected, valueName]);

  const preview = useMemo(() => {
    if (options.columns.length === 0) return { result: null, problem: null };
    try {
      return { result: unpivotTable(snapshot.rows, { ...options, separator: separator || undefined }), problem: null };
    } catch (error) {
      return { result: null, problem: error instanceof Error ? error.message : String(error) };
    }
  }, [options, separator, snapshot.rows]);

  const result = preview.result;
  const run = async () => {
    if (!result) return;
    setBusy(true);
    setFailure(null);
    try {
      await applyGridRowEdits(documentId, {
        label: "Unpivot",
        summary: `Unpivoted ${plural(options.columns.length, "column")}: ${plural(snapshot.rows.length, "row")} became ${result.entries.length.toLocaleString()}.`,
        sourceRevision: snapshot.table.sourceRevision,
        ...unpivotRowEdits(snapshot.table, result, options),
      });
      onDone();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <form className="flex min-w-0 flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void run(); }}>
      <ColumnChecklist
        label="Columns to turn into rows"
        columns={dataColumns}
        selected={selected}
        onToggle={(id) => setSelected((previous) => {
          const next = new Set(previous);
          if (!next.delete(id)) next.add(id);
          return next;
        })}
      />
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <label className="flex min-w-0 flex-col gap-2 text-xs"><span>Column for the names</span>
          <Input variant="field" name="category-column" autoComplete="off" spellCheck={false} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
        </label>
        <label className="flex min-w-0 flex-col gap-2 text-xs"><span>Column for the values</span>
          <Input variant="field" name="value-column" autoComplete="off" spellCheck={false} value={valueName} onChange={(event) => setValueName(event.target.value)} />
        </label>
      </div>
      <label className="flex min-w-0 flex-col gap-2 text-xs"><span>Split cells at</span>
        <Input variant="field" name="separator" autoComplete="off" spellCheck={false} maxLength={8} placeholder="Do not split" value={separator} onChange={(event) => setSeparator(event.target.value)} />
      </label>
      {result ? (
        <Outcome lines={[
          `${plural(snapshot.rows.length, "row")} → ${result.entries.length.toLocaleString()}`,
          result.emptyRows.length > 0 && `${plural(result.emptyRows.length, "row")} without a value in these columns kept once`,
        ]} />
      ) : null}
      {preview.problem ?? failure ? <p className="break-words text-sm text-(--color-text-danger)" role="alert">{preview.problem ?? failure}</p> : null}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!result || busy}>Unpivot</Button>
      </DialogFooter>
    </form>
  );
}

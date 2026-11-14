import { useMemo, useState } from "react";
import { columnKey, isDataColumn, pivotRowEdits } from "../../lib/grid-reshape";
import { applyGridRowEdits } from "../../lib/grid-table-bridge";
import { categoryCounts, pivotTable, type PivotDuplicates } from "../../lib/table-shaping";
import { Button } from "../ui/button";
import { DialogFooter } from "../ui/dialog";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ColumnSelect, Outcome, plural } from "./fields";
import type { GridTableSnapshot } from "./use-grid-table";

// A category column with more values than this would add that many columns,
// which is a sign the wrong column was picked.
const MAX_NEW_COLUMNS = 200;
const SHOWN_NEW_COLUMNS = 6;

const DUPLICATE_CHOICES: Array<{ value: PivotDuplicates; label: string }> = [
  { value: "join", label: "Keep all" },
  { value: "first", label: "First" },
  { value: "last", label: "Last" },
  { value: "mean", label: "Mean" },
];

export function PivotForm({ documentId, snapshot, onDone }: { documentId: string; snapshot: GridTableSnapshot; onDone: () => void }) {
  const dataColumns = useMemo(() => snapshot.columns.filter(isDataColumn), [snapshot.columns]);
  const categories = useMemo(() => new Map(dataColumns.map((column) => [
    column.id,
    categoryCounts(snapshot.rows.map((row) => row[columnKey(column)] ?? ""), MAX_NEW_COLUMNS),
  ])), [dataColumns, snapshot.rows]);

  // Start from the likeliest reading of the table: the first data column is
  // the key, the first other text column with repeating values names the new
  // columns, and the first number left over fills them.
  const [keyId, setKeyId] = useState(() => dataColumns[0]?.id ?? snapshot.columns[0].id);
  const [categoryId, setCategoryId] = useState(() => (
    dataColumns.find((column) => column.id !== keyId && column.type === "text"
      && (categories.get(column.id)?.length ?? snapshot.rows.length) < snapshot.rows.length)
    ?? dataColumns.find((column) => column.id !== keyId)
  )?.id ?? "");
  const [valueId, setValueId] = useState(() => (
    dataColumns.find((column) => column.id !== keyId && column.id !== categoryId && column.type === "number")
    ?? dataColumns.find((column) => column.id !== keyId && column.id !== categoryId)
  )?.id ?? "");
  const [duplicates, setDuplicates] = useState<PivotDuplicates>("join");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A column picked for one role leaves the lists of the roles after it, and a
  // role whose column was taken falls to the first one still free.
  const key = snapshot.columns.find((candidate) => candidate.id === keyId);
  const categoryOptions = dataColumns.filter((candidate) => candidate.id !== keyId);
  const category = categoryOptions.find((candidate) => candidate.id === categoryId) ?? categoryOptions[0];
  const valueOptions = categoryOptions.filter((candidate) => candidate.id !== category?.id);
  const value = valueOptions.find((candidate) => candidate.id === valueId) ?? valueOptions[0];

  const preview = useMemo(() => {
    if (!key || !category || !value) return { result: null, problem: null };
    if (categories.get(category.id) === null) {
      return { result: null, problem: `${category.label} has more than ${MAX_NEW_COLUMNS} different values.` };
    }
    try {
      return {
        result: pivotTable(snapshot.rows, {
          keyColumn: columnKey(key),
          categoryColumn: columnKey(category),
          valueColumn: columnKey(value),
          duplicates,
        }),
        problem: null,
      };
    } catch (error) {
      return { result: null, problem: error instanceof Error ? error.message : String(error) };
    }
  }, [categories, category, duplicates, key, snapshot.rows, value]);

  const result = preview.result;
  const rowsAfter = result ? result.groups.length + result.emptyKeyRows.length : 0;
  const counts = category ? categories.get(category.id) ?? [] : [];
  const newColumns = result
    ? result.columns.map((name) => `${name} (${(counts.find((entry) => entry.value === name)?.count ?? 0).toLocaleString()})`)
    : [];
  const ready = Boolean(result && result.columns.length > 0) && !busy;

  const run = async () => {
    if (!result || !key || !category || !value) return;
    setBusy(true);
    setFailure(null);
    try {
      await applyGridRowEdits(documentId, {
        label: "Pivot",
        summary: `Pivoted ${plural(snapshot.rows.length, "row")} into ${rowsAfter.toLocaleString()} by ${key.label}.`,
        sourceRevision: snapshot.table.sourceRevision,
        ...pivotRowEdits(snapshot.table, result, [columnKey(category), columnKey(value)]),
      });
      onDone();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <form className="flex min-w-0 flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void run(); }}>
      <ColumnSelect label="One row per" name="key" value={keyId} columns={snapshot.columns} onChange={setKeyId} />
      <ColumnSelect label="New columns from" name="category" value={category?.id ?? ""} columns={categoryOptions} onChange={setCategoryId} />
      <ColumnSelect label="Values from" name="value" value={value?.id ?? ""} columns={valueOptions} onChange={setValueId} />
      {result && result.duplicateCells.length > 0 ? (
        <label className="flex min-w-0 flex-col gap-2 text-xs"><span>Several values in one cell</span>
          <NativeSelect name="duplicates" className="w-full" value={duplicates} onChange={(event) => setDuplicates(event.target.value as PivotDuplicates)}>
            {DUPLICATE_CHOICES.map((choice) => <NativeSelectOption key={choice.value} value={choice.value}>{choice.label}</NativeSelectOption>)}
          </NativeSelect>
        </label>
      ) : null}
      {result ? (
        <Outcome lines={[
          `${plural(snapshot.rows.length, "row")} → ${rowsAfter.toLocaleString()}`,
          newColumns.length > 0 && `${plural(newColumns.length, "new column")}: ${newColumns.slice(0, SHOWN_NEW_COLUMNS).join(", ")}${newColumns.length > SHOWN_NEW_COLUMNS ? ` and ${(newColumns.length - SHOWN_NEW_COLUMNS).toLocaleString()} more` : ""}`,
          newColumns.length === 0 && `${value?.label} has no values to place.`,
          result.duplicateCells.length > 0 && `${plural(result.duplicateCells.length, "cell")} with several values`,
          result.emptyKeyRows.length > 0 && `${plural(result.emptyKeyRows.length, "row")} without ${key?.label} left as ${result.emptyKeyRows.length === 1 ? "it is" : "they are"}`,
          result.droppedValueRows.length > 0 && `${plural(result.droppedValueRows.length, "value")} without ${category?.label} dropped`,
          result.carriedConflicts.length > 0 && `${plural(result.carriedConflicts.length, "other cell")} differ within a row group; the first row's value is kept`,
        ]} />
      ) : null}
      {preview.problem ?? failure ? <p className="break-words text-sm text-(--color-text-danger)" role="alert">{preview.problem ?? failure}</p> : null}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!ready}>Pivot</Button>
      </DialogFooter>
    </form>
  );
}

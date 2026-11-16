import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { columnKey, isDataColumn, mergeRowEdits } from "../../lib/grid-reshape";
import { applyGridRowEdits } from "../../lib/grid-table-bridge";
import { mergeByKey, parseDelimitedTable, parseSdfDataTable, type ParsedTable } from "../../lib/table-shaping";
import { Button } from "../ui/button";
import { DialogFooter } from "../ui/dialog";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ColumnChecklist, ColumnSelect, Outcome, plural } from "./fields";
import type { GridTableSnapshot } from "./use-grid-table";

const SHOWN_KEYS = 5;

function keyList(keys: string[]) {
  return `${keys.slice(0, SHOWN_KEYS).join(", ")}${keys.length > SHOWN_KEYS ? "…" : ""}`;
}

export function MergeForm({ documentId, snapshot, onDone }: { documentId: string; snapshot: GridTableSnapshot; onDone: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; table: ParsedTable } | null>(null);
  const [leftKeyId, setLeftKeyId] = useState(() => (snapshot.columns.find(isDataColumn) ?? snapshot.columns[0]).id);
  // Null until the user picks one: the file's key is then the column that matches the most rows.
  const [rightKeyChoice, setRightKeyChoice] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [duplicates, setDuplicates] = useState<"first" | "expand">("first");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const leftKey = snapshot.columns.find((column) => column.id === leftKeyId) ?? snapshot.columns[0];

  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    setFailure(null);
    try {
      const text = await picked.text();
      const table = /\.sdf?$/iu.test(picked.name) ? parseSdfDataTable(text) : parseDelimitedTable(text);
      if (table.columns.length === 0 || table.rows.length === 0) throw new Error(`${picked.name} has no table to merge.`);
      setFile({ name: picked.name, table });
      setRightKeyChoice(null);
      setExcluded(new Set());
    } catch (error) {
      setFile(null);
      setFailure(error instanceof Error ? error.message : String(error));
    }
  };

  const likelyRightKey = useMemo(() => {
    if (!file) return "";
    const leftKeys = new Set(snapshot.rows.map((row) => (row[columnKey(leftKey)] ?? "").trim()).filter(Boolean));
    let best = file.table.columns[0];
    let bestMatches = -1;
    for (const column of file.table.columns) {
      const matches = file.table.rows.reduce((count, row) => count + Number(leftKeys.has((row[column] ?? "").trim())), 0);
      if (matches > bestMatches) {
        best = column;
        bestMatches = matches;
      }
    }
    return best;
  }, [file, leftKey, snapshot.rows]);
  const rightKey = rightKeyChoice ?? likelyRightKey;
  const addable = file ? file.table.columns.filter((column) => column !== rightKey) : [];
  const chosen = useMemo(
    () => (file ? file.table.columns.filter((column) => column !== rightKey && !excluded.has(column)) : []),
    [excluded, file, rightKey],
  );

  const result = useMemo(() => (file && chosen.length > 0
    ? mergeByKey(snapshot.rows, file.table.rows, {
        leftKey: columnKey(leftKey),
        rightKey,
        columns: chosen,
        duplicates,
        existingColumns: snapshot.columns.filter(isDataColumn).map(columnKey),
      })
    : null
  ), [chosen, duplicates, file, leftKey, rightKey, snapshot]);

  const run = async () => {
    if (!file || !result) return;
    setBusy(true);
    setFailure(null);
    try {
      await applyGridRowEdits(documentId, {
        label: "Merge File by Key",
        summary: `Merged ${plural(result.columns.length, "column")} from ${file.name} into ${result.matchedRows.toLocaleString()} of ${plural(snapshot.rows.length, "row")} by ${leftKey.label}.`,
        sourceRevision: snapshot.table.sourceRevision,
        ...mergeRowEdits(snapshot.table, result),
      });
      onDone();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  const renamed = result ? result.columns.filter((column) => column.name !== column.source) : [];

  return (
    <form className="flex min-w-0 flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void run(); }}>
      <div className="flex min-w-0 items-center gap-3">
        <input ref={fileInput} type="file" accept=".csv,.tsv,.tab,.txt,.sdf,.sd" hidden aria-label="File to merge" onChange={(event) => void openFile(event)} />
        <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>Choose file…</Button>
        {file ? <span className="min-w-0 truncate text-sm" title={file.name}>{file.name}</span> : null}
      </div>
      {file ? (
        <>
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <ColumnSelect label="Key in the collection" name="left-key" value={leftKey.id} columns={snapshot.columns} onChange={setLeftKeyId} />
            <ColumnSelect label="Key in the file" name="right-key" value={rightKey} columns={file.table.columns.map((column) => ({ id: column, label: column, type: "text" }))} onChange={setRightKeyChoice} />
          </div>
          <ColumnChecklist
            label="Columns to add"
            columns={addable.map((column) => ({ id: column, label: column }))}
            selected={new Set(chosen)}
            onToggle={(id) => setExcluded((previous) => {
              const next = new Set(previous);
              if (!next.delete(id)) next.add(id);
              return next;
            })}
          />
          {result && result.duplicateRight.length > 0 ? (
            <label className="flex min-w-0 flex-col gap-2 text-xs"><span>Repeated keys in the file</span>
              <NativeSelect name="duplicates" className="w-full" value={duplicates} onChange={(event) => setDuplicates(event.target.value === "expand" ? "expand" : "first")}>
                <NativeSelectOption value="first">Use the first row</NativeSelectOption>
                <NativeSelectOption value="expand">Add a row for each</NativeSelectOption>
              </NativeSelect>
            </label>
          ) : null}
          {result ? (
            <Outcome lines={[
              `${result.matchedRows.toLocaleString()} of ${plural(snapshot.rows.length, "row")} matched`,
              result.entries.length > snapshot.rows.length && `${plural(snapshot.rows.length, "row")} → ${result.entries.length.toLocaleString()}`,
              result.unmatchedLeft.length > 0 && `${plural(result.unmatchedLeft.length, "row")} without a match: ${keyList(result.unmatchedLeft.map((position) => (snapshot.rows[position][columnKey(leftKey)] ?? "").trim()))}`,
              result.emptyLeftKeys.length > 0 && `${plural(result.emptyLeftKeys.length, "row")} without ${leftKey.label}`,
              result.unmatchedRight.length > 0 && `${plural(result.unmatchedRight.length, "key")} only in the file: ${keyList(result.unmatchedRight)}`,
              result.duplicateRight.length > 0 && `${plural(result.duplicateRight.length, "repeated key")} in the file: ${keyList(result.duplicateRight.map((entry) => entry.key))}`,
              result.emptyRightKeys > 0 && `${plural(result.emptyRightKeys, "file row")} without a key`,
              renamed.length > 0 && `Added as ${renamed.map((column) => column.name).join(", ")}`,
            ]} />
          ) : null}
        </>
      ) : null}
      {failure ? <p className="break-words text-sm text-(--color-text-danger)" role="alert">{failure}</p> : null}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!result || result.matchedRows === 0 || busy}>Merge</Button>
      </DialogFooter>
    </form>
  );
}

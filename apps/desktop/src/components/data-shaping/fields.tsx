import type { ReactNode } from "react";
import type { ReshapeColumn } from "../../lib/grid-reshape";
import { Checkbox } from "../ui/checkbox";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";

export function ColumnSelect({ label, name, value, columns, onChange }: {
  label: string;
  name: string;
  value: string;
  columns: readonly ReshapeColumn[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-xs"><span>{label}</span>
      <NativeSelect name={name} className="w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        {columns.map((column) => <NativeSelectOption key={column.id} value={column.id}>{column.label}</NativeSelectOption>)}
      </NativeSelect>
    </label>
  );
}

export function ColumnChecklist({ label, columns, selected, onToggle }: {
  label: string;
  columns: ReadonlyArray<{ id: string; label: string }>;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 text-xs"><span>{label}</span>
      <div className="max-h-44 overflow-y-auto overscroll-contain rounded-2xl border border-(--color-border) px-4 py-2" role="group" aria-label={label}>
        {columns.map((column) => (
          <label key={column.id} className="flex min-w-0 items-center gap-2 py-1 text-sm [content-visibility:auto] [contain-intrinsic-size:auto_28px]">
            <Checkbox checked={selected.has(column.id)} onCheckedChange={() => onToggle(column.id)} />
            <span className="min-w-0 break-words">{column.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** What the command will do to the table, shown before it runs. Empty lines are left out. */
export function Outcome({ lines }: { lines: Array<ReactNode | false | null> }) {
  const shown = lines.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs tabular-nums text-(--color-text-secondary)" role="status" aria-label="Result">
      {shown.map((line, index) => <li key={index} className="min-w-0 break-words">{line}</li>)}
    </ul>
  );
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

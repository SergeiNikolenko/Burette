import type { GridRowCells, GridRowEdits, GridTable } from "./grid-table-bridge";
import type { MergeResult, PivotResult, TableRow, UnpivotResult } from "./table-shaping";

// Turns a collection read out of the grid into the rows lib/table-shaping works
// on, and a shaping result back into the row edits the grid applies.

/** A grid column a reshape can read. Only a data column of the file (`prop:NAME`) can be written or removed. */
export type ReshapeColumn = { id: string; label: string; type: "number" | "text" };

/** The molecule name is not in the grid's list of data columns, but it is a common key. */
export const NAME_COLUMN: ReshapeColumn = { id: "name", label: "Name", type: "text" };

const PROPERTY_PREFIX = "prop:";

export function isDataColumn(column: ReshapeColumn) {
  return column.id.startsWith(PROPERTY_PREFIX);
}

/**
 * The name a column has inside a table row. A data column goes by its own
 * name, which is also the cell an edit writes; any other column gets a name no
 * data column can have, so a new column can never be mistaken for it.
 */
export function columnKey(column: Pick<ReshapeColumn, "id">) {
  return column.id.startsWith(PROPERTY_PREFIX) ? column.id.slice(PROPERTY_PREFIX.length) : `\u0001${column.id}`;
}

export function tableRows(table: GridTable, columns: readonly ReshapeColumn[]): TableRow[] {
  const keys = columns.map(columnKey);
  return table.rows.map(({ cells }) => {
    const row: Record<string, string> = {};
    keys.forEach((key, position) => {
      if (cells[position].trim() !== "") row[key] = cells[position];
    });
    return row;
  });
}

type Edits = Pick<GridRowEdits, "patches" | "inserts" | "hide">;

/** The first row of every key takes the new cells and loses the two pivoted columns; the rest of the key is folded away. */
export function pivotRowEdits(table: GridTable, result: PivotResult, remove: string[]): Edits {
  return {
    patches: result.groups.map((group) => ({ index: table.rows[group.sources[0]].index, set: group.values, remove })),
    hide: result.groups.flatMap((group) => group.sources.slice(1).map((position) => table.rows[position].index)),
  };
}

/** The first value of a row is written into the row itself; every further value is a copy of the row placed after it. */
export function unpivotRowEdits(
  table: GridTable,
  result: UnpivotResult,
  options: { columns: string[]; categoryColumn: string; valueColumn: string },
): Edits {
  const patches: NonNullable<Edits["patches"]> = [];
  const inserts: NonNullable<Edits["inserts"]> = [];
  const written = new Set<number>();
  for (const entry of result.entries) {
    if (entry.category === null) continue;
    const index = table.rows[entry.source].index;
    const cells: GridRowCells = {
      remove: options.columns,
      set: { [options.categoryColumn]: entry.category, [options.valueColumn]: entry.value },
    };
    if (written.has(entry.source)) inserts.push({ afterIndex: index, ...cells });
    else patches.push({ index, ...cells });
    written.add(entry.source);
  }
  return { patches, inserts };
}

/** A matched row gains the new cells; a further match of the same row, when repeated keys expand, is a copy of it. */
export function mergeRowEdits(table: GridTable, result: MergeResult): Edits {
  const patches: NonNullable<Edits["patches"]> = [];
  const inserts: NonNullable<Edits["inserts"]> = [];
  const written = new Set<number>();
  for (const entry of result.entries) {
    if (entry.right === null) continue;
    const index = table.rows[entry.left].index;
    if (written.has(entry.left)) inserts.push({ afterIndex: index, set: entry.values });
    else patches.push({ index, set: entry.values });
    written.add(entry.left);
  }
  return { patches, inserts };
}

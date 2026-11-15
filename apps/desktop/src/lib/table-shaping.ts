// Table operations behind Collection ▸ Pivot, Unpivot and Merge File by Key,
// and the value counts of a category column. Everything here is a pure
// function over rows of text cells, so the same code answers the dialog's
// preview and produces the edit the grid applies.
//
// A row is a record of column name → cell text. A cell that is absent or holds
// only white space is an empty cell; the two are never told apart.

export type TableRow = Readonly<Record<string, string>>;

/** What Merge Equivalent Rows already puts between values that share a cell. */
export const JOINED_VALUE_SEPARATOR = "; ";

function cellText(row: TableRow, column: string) {
  return String(row[column] ?? "");
}

function isEmpty(text: string) {
  return text.trim() === "";
}

function withoutColumns(row: TableRow, columns: ReadonlySet<string>) {
  const kept: Record<string, string> = {};
  for (const [column, value] of Object.entries(row)) {
    if (!columns.has(column) && !isEmpty(String(value ?? ""))) kept[column] = String(value);
  }
  return kept;
}

// --- Pivot -------------------------------------------------------------------

/** What a pivot cell holds when a key has several rows of the same category. */
export type PivotDuplicates = "join" | "first" | "last" | "mean";

export type PivotOptions = {
  keyColumn: string;
  categoryColumn: string;
  valueColumn: string;
  duplicates?: PivotDuplicates;
  separator?: string;
};

export type PivotGroup = {
  key: string;
  /** Positions of the rows that share the key; the first one is the row that stays. */
  sources: number[];
  /** New column → cell, only for the categories this key has a value for. */
  values: Record<string, string>;
};

export type PivotResult = {
  /** The new columns, one per category, in the order the categories first appear. */
  columns: string[];
  /** One group per key, in the order the keys first appear. */
  groups: PivotGroup[];
  /** The pivoted table: the first row of every key and the rows without a key, in their original order. */
  rows: TableRow[];
  /** Rows without a key. They belong to no group and stay as they are. */
  emptyKeyRows: number[];
  /** Rows that hold a value but no category, so the value has no column to go to. */
  droppedValueRows: number[];
  /** Cells that received more than one value, with every value in row order. */
  duplicateCells: Array<{ key: string; category: string; values: string[] }>;
  /** Other columns whose values differ inside a key; the first row's value is the one kept. */
  carriedConflicts: Array<{ key: string; column: string }>;
};

function combineDuplicates(values: string[], duplicates: PivotDuplicates, separator: string) {
  if (values.length === 1) return values[0];
  if (duplicates === "first") return values[0];
  if (duplicates === "last") return values[values.length - 1];
  if (duplicates === "mean") {
    const numbers = values.map((value) => Number(value.trim()));
    if (numbers.every((number) => Number.isFinite(number))) {
      const mean = numbers.reduce((sum, number) => sum + number, 0) / numbers.length;
      return String(Number(mean.toPrecision(12)));
    }
  }
  return values.join(separator);
}

/**
 * One row per key with one column per value of the category column.
 * Throws when a category is named like a column the keyed rows already use,
 * because the new column would overwrite it.
 */
export function pivotTable(rows: readonly TableRow[], options: PivotOptions): PivotResult {
  const { keyColumn, categoryColumn, valueColumn } = options;
  const duplicates = options.duplicates ?? "join";
  const separator = options.separator ?? JOINED_VALUE_SEPARATOR;
  if (new Set([keyColumn, categoryColumn, valueColumn]).size !== 3) {
    throw new Error("The key, category and value columns have to be three different columns.");
  }
  const pivoted = new Set([categoryColumn, valueColumn]);
  const groups = new Map<string, PivotGroup>();
  const cells = new Map<PivotGroup, Map<string, string[]>>();
  const columns: string[] = [];
  const seenColumns = new Set<string>();
  const emptyKeyRows: number[] = [];
  const droppedValueRows: number[] = [];
  const usedColumns = new Set<string>();

  rows.forEach((row, position) => {
    const key = cellText(row, keyColumn).trim();
    if (!key) {
      emptyKeyRows.push(position);
      return;
    }
    for (const [column, value] of Object.entries(row)) {
      if (!pivoted.has(column) && !isEmpty(String(value ?? ""))) usedColumns.add(column);
    }
    let group = groups.get(key);
    if (!group) {
      group = { key, sources: [], values: {} };
      groups.set(key, group);
      cells.set(group, new Map());
    }
    group.sources.push(position);
    const category = cellText(row, categoryColumn).trim();
    const value = cellText(row, valueColumn);
    if (isEmpty(value)) return;
    if (!category) {
      droppedValueRows.push(position);
      return;
    }
    if (!seenColumns.has(category)) {
      seenColumns.add(category);
      columns.push(category);
    }
    const groupCells = cells.get(group)!;
    const list = groupCells.get(category);
    if (list) list.push(value);
    else groupCells.set(category, [value]);
  });

  for (const column of columns) {
    if (usedColumns.has(column)) {
      throw new Error(`${categoryColumn} holds the value "${column}", which is already a column.`);
    }
  }

  const duplicateCells: PivotResult["duplicateCells"] = [];
  const carriedConflicts: PivotResult["carriedConflicts"] = [];
  const firstRowGroup = new Map<number, PivotGroup>();
  for (const group of groups.values()) {
    firstRowGroup.set(group.sources[0], group);
    for (const [category, values] of cells.get(group)!) {
      if (values.length > 1) duplicateCells.push({ key: group.key, category, values });
      group.values[category] = combineDuplicates(values, duplicates, separator);
    }
    if (group.sources.length < 2) continue;
    const carried = new Map<string, string>();
    const conflicting = new Set<string>();
    for (const position of group.sources) {
      for (const [column, value] of Object.entries(withoutColumns(rows[position], pivoted))) {
        if (column === keyColumn || conflicting.has(column)) continue;
        const previous = carried.get(column);
        if (previous === undefined) carried.set(column, value.trim());
        else if (previous !== value.trim()) conflicting.add(column);
      }
    }
    for (const column of conflicting) carriedConflicts.push({ key: group.key, column });
  }

  const emptyKeys = new Set(emptyKeyRows);
  const table: TableRow[] = [];
  rows.forEach((row, position) => {
    if (emptyKeys.has(position)) {
      table.push(row);
      return;
    }
    const group = firstRowGroup.get(position);
    if (group) table.push({ ...withoutColumns(row, pivoted), ...group.values });
  });

  return {
    columns,
    groups: [...groups.values()],
    rows: table,
    emptyKeyRows,
    droppedValueRows,
    duplicateCells,
    carriedConflicts,
  };
}

// --- Unpivot -----------------------------------------------------------------

export type UnpivotOptions = {
  /** The columns that become rows, in the order their rows are written. */
  columns: readonly string[];
  categoryColumn: string;
  valueColumn: string;
  /** Write a row for an empty cell too. Off by default, which is what undoes a pivot. */
  keepEmpty?: boolean;
  /** Split a cell at this separator into one row per value: the inverse of a pivot that joined them. */
  separator?: string;
};

export type UnpivotEntry = {
  /** Position of the row this one was made from. */
  source: number;
  /** Null for a row that had no value in any of the columns. */
  category: string | null;
  value: string;
};

export type UnpivotResult = {
  /** Every output row, grouped by source row; each source row appears at least once. */
  entries: UnpivotEntry[];
  /** The long table, one row per entry. */
  rows: TableRow[];
  /** Source rows without a value in any of the columns. They are kept once, unchanged apart from those columns. */
  emptyRows: number[];
};

/** One row per non-empty cell of the chosen columns, with the column name and the cell side by side. */
export function unpivotTable(rows: readonly TableRow[], options: UnpivotOptions): UnpivotResult {
  const { categoryColumn, valueColumn } = options;
  const columns = [...new Set(options.columns)];
  if (columns.length === 0) throw new Error("Choose at least one column to unpivot.");
  if (categoryColumn.trim() === "" || valueColumn.trim() === "") {
    throw new Error("The category and value columns need a name.");
  }
  if (categoryColumn === valueColumn) {
    throw new Error("The category and value columns have to be two different columns.");
  }
  if (columns.includes(categoryColumn) || columns.includes(valueColumn)) {
    throw new Error("A column cannot be unpivoted into itself.");
  }
  const unpivoted = new Set(columns);
  const entries: UnpivotEntry[] = [];
  const table: TableRow[] = [];
  const emptyRows: number[] = [];
  rows.forEach((row, source) => {
    const rest = withoutColumns(row, unpivoted);
    let written = 0;
    for (const column of columns) {
      const text = cellText(row, column);
      const values = isEmpty(text)
        ? (options.keepEmpty ? [""] : [])
        : options.separator
          ? text.split(options.separator).map((part) => part.trim()).filter((part) => part !== "")
          : [text];
      for (const value of values) {
        entries.push({ source, category: column, value });
        const next: Record<string, string> = { ...rest, [categoryColumn]: column };
        if (isEmpty(value)) delete next[valueColumn];
        else next[valueColumn] = value;
        table.push(next);
        written += 1;
      }
    }
    if (written === 0) {
      emptyRows.push(source);
      entries.push({ source, category: null, value: "" });
      table.push(rest);
    }
  });
  return { entries, rows: table, emptyRows };
}

// --- Merge by key ------------------------------------------------------------

export type MergeOptions = {
  leftKey: string;
  rightKey: string;
  /** Columns of the other table to bring in. Defaults to all of them except its key. */
  columns?: readonly string[];
  /**
   * A key that repeats in the other table: "first" uses its first row, "expand"
   * writes one row per match, which is what a relational left join does.
   */
  duplicates?: "first" | "expand";
  /** Columns the left table already has, when its rows carry only part of them. */
  existingColumns?: readonly string[];
  /** Appended to an incoming column whose name is taken. */
  suffix?: string;
};

export type MergeEntry = {
  /** Position of the left row. */
  left: number;
  /** Position of the matching row of the other table, or null without a match. */
  right: number | null;
  /** New column → cell, for the non-empty cells of the matching row. */
  values: Record<string, string>;
};

export type MergeResult = {
  /** The columns brought in: their name in the other table and the name they get. */
  columns: Array<{ source: string; name: string }>;
  /** One entry per output row, in left order. "expand" gives a left row one entry per match. */
  entries: MergeEntry[];
  /** The joined table, one row per entry. */
  rows: TableRow[];
  /** Left rows that found a match. */
  matchedRows: number;
  /** Left rows whose key is not in the other table. */
  unmatchedLeft: number[];
  /** Left rows without a key. An empty key never matches anything. */
  emptyLeftKeys: number[];
  /** Keys of the other table that no left row has, in the order they appear. */
  unmatchedRight: string[];
  /** Rows of the other table without a key. */
  emptyRightKeys: number;
  /** Keys that occur more than once in the other table. */
  duplicateRight: Array<{ key: string; count: number }>;
  /** Keys that occur more than once on the left; every one of those rows gets the match. */
  duplicateLeft: Array<{ key: string; count: number }>;
};

/** A left join: every left row stays, and gains the other table's columns where its key matches. */
export function mergeByKey(
  left: readonly TableRow[],
  right: readonly TableRow[],
  options: MergeOptions,
): MergeResult {
  const { leftKey, rightKey } = options;
  const duplicates = options.duplicates ?? "first";
  const suffix = options.suffix ?? "_2";
  const rightColumns: string[] = [];
  const seenRight = new Set<string>();
  for (const row of right) {
    for (const column of Object.keys(row)) {
      if (!seenRight.has(column)) {
        seenRight.add(column);
        rightColumns.push(column);
      }
    }
  }
  const wanted = options.columns
    ? [...new Set(options.columns)]
    : rightColumns.filter((column) => column !== rightKey);
  const taken = new Set<string>(options.existingColumns ?? left.flatMap((row) => Object.keys(row)));
  taken.add(leftKey);
  const columns = wanted.map((source) => {
    let name = source;
    while (taken.has(name)) name += suffix;
    taken.add(name);
    return { source, name };
  });

  const rightByKey = new Map<string, number[]>();
  let emptyRightKeys = 0;
  right.forEach((row, position) => {
    const key = cellText(row, rightKey).trim();
    if (!key) {
      emptyRightKeys += 1;
      return;
    }
    const positions = rightByKey.get(key);
    if (positions) positions.push(position);
    else rightByKey.set(key, [position]);
  });

  const valuesOf = (position: number) => {
    const values: Record<string, string> = {};
    for (const { source, name } of columns) {
      const text = cellText(right[position], source);
      if (!isEmpty(text)) values[name] = text;
    }
    return values;
  };

  const entries: MergeEntry[] = [];
  const unmatchedLeft: number[] = [];
  const emptyLeftKeys: number[] = [];
  const leftCounts = new Map<string, number>();
  const usedRight = new Set<string>();
  let matchedRows = 0;
  left.forEach((row, position) => {
    const key = cellText(row, leftKey).trim();
    if (!key) {
      emptyLeftKeys.push(position);
      entries.push({ left: position, right: null, values: {} });
      return;
    }
    leftCounts.set(key, (leftCounts.get(key) ?? 0) + 1);
    const matches = rightByKey.get(key);
    if (!matches) {
      unmatchedLeft.push(position);
      entries.push({ left: position, right: null, values: {} });
      return;
    }
    matchedRows += 1;
    usedRight.add(key);
    for (const match of duplicates === "expand" ? matches : matches.slice(0, 1)) {
      entries.push({ left: position, right: match, values: valuesOf(match) });
    }
  });

  return {
    columns,
    entries,
    rows: entries.map((entry) => ({ ...left[entry.left], ...entry.values })),
    matchedRows,
    unmatchedLeft,
    emptyLeftKeys,
    unmatchedRight: [...rightByKey.keys()].filter((key) => !usedRight.has(key)),
    emptyRightKeys,
    duplicateRight: [...rightByKey]
      .filter(([, positions]) => positions.length > 1)
      .map(([key, positions]) => ({ key, count: positions.length })),
    duplicateLeft: [...leftCounts]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({ key, count })),
  };
}

// --- Category counts ---------------------------------------------------------

export type CategoryCount = { value: string; count: number };

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * How often each value occurs, most frequent first. The empty string stands
 * for the empty cells. Returns null as soon as there are more distinct values
 * than `limit`: such a column is free text, not a set of categories.
 */
export function categoryCounts(values: Iterable<string>, limit: number): CategoryCount[] | null {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    const count = counts.get(value);
    if (count === undefined) {
      if (counts.size >= limit) return null;
      counts.set(value, 1);
    } else {
      counts.set(value, count + 1);
    }
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || naturalOrder.compare(a.value, b.value));
}

// --- Reading the other table ---------------------------------------------------

export type ParsedTable = { columns: string[]; rows: TableRow[] };

function uniqueHeaders(headers: string[]) {
  const seen = new Set<string>();
  return headers.map((header, index) => {
    const base = header.trim() || `Column ${index + 1}`;
    let name = base;
    for (let copy = 2; seen.has(name); copy += 1) name = `${base} ${copy}`;
    seen.add(name);
    return name;
  });
}

function detectSeparator(text: string) {
  const firstLine = text.slice(0, text.search(/\r?\n|$/u));
  let best = ",";
  let bestCount = 0;
  for (const candidate of ["\t", ",", ";"]) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** A delimited text file with a header line. Quoted cells may hold the separator, quotes and line breaks. */
export function parseDelimitedTable(text: string, separator?: string): ParsedTable {
  const source = text.replace(/^﻿/u, "");
  const delimiter = separator ?? detectSeparator(source);
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  let cellStarted = false;
  const endCell = () => {
    record.push(cell);
    cell = "";
    cellStarted = false;
  };
  const endRecord = () => {
    endCell();
    if (record.length > 1 || record[0].trim() !== "") records.push(record);
    record = [];
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"' && !cellStarted) {
      quoted = true;
      cellStarted = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      endRecord();
    } else {
      cell += char;
      cellStarted = true;
    }
  }
  if (cell !== "" || record.length > 0) endRecord();
  if (records.length === 0) return { columns: [], rows: [] };
  const columns = uniqueHeaders(records[0]);
  const rows = records.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      const value = cells[index] ?? "";
      if (!isEmpty(value)) row[column] = value;
    });
    return row;
  });
  return { columns, rows };
}

/** The data fields of an SD file, one row per record. Structures are not read. */
export function parseSdfDataTable(text: string): ParsedTable {
  const columns: string[] = [];
  const seen = new Set<string>();
  const rows: TableRow[] = [];
  for (const record of text.replace(/\r\n?/gu, "\n").split(/^\$\$\$\$[^\n]*$/mu)) {
    if (record.trim() === "") continue;
    const row: Record<string, string> = {};
    const lines = record.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const header = /^>.*<([^>]+)>/u.exec(lines[index]);
      if (!header) continue;
      const values: string[] = [];
      for (index += 1; index < lines.length && lines[index].trim() !== ""; index += 1) values.push(lines[index]);
      const column = header[1].trim();
      if (!column) continue;
      if (!seen.has(column)) {
        seen.add(column);
        columns.push(column);
      }
      const value = values.join("\n");
      if (!isEmpty(value)) row[column] = value;
    }
    rows.push(row);
  }
  return { columns, rows };
}

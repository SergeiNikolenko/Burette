import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  categoryCounts,
  mergeByKey,
  parseDelimitedTable,
  parseSdfDataTable,
  pivotTable,
  unpivotTable,
  type TableRow,
} from "../apps/desktop/src/lib/table-shaping";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/table-shaping/${name}`, import.meta.url), "utf8");

// A table is compared as a bag of rows of non-empty cells: Pivot and Unpivot
// promise the cells, not where a row sits or whether an empty cell is spelled out.
function bag(rows: readonly TableRow[]) {
  return rows
    .map((row) => JSON.stringify(Object.entries(row).filter(([, value]) => value.trim() !== "").sort()))
    .sort();
}

// Deterministic generator, so a failing table can be reproduced from its seed.
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const KEYS = ["CHEMBL25", "CHEMBL521", "CHEMBL154", "CHEMBL139", "CHEMBL112"];
const ASSAYS = ["COX-1", "COX-2", "hERG", "Solubility"];
const PIVOT = { keyColumn: "ID", categoryColumn: "Assay", valueColumn: "Value" } as const;
const UNPIVOT = { categoryColumn: "Assay", valueColumn: "Value" } as const;

// A long table in shuffled row order: each key has a random subset of the
// assays (so cells are missing), and a SMILES column that depends on the key
// alone, which is what the pivot carries over.
function longTable(seed: number, options: { emptyValues?: boolean; repeats?: boolean; emptyKeys?: boolean } = {}) {
  const next = random(seed);
  const rows: Array<Record<string, string>> = [];
  for (const key of KEYS.slice(0, 2 + Math.floor(next() * 4))) {
    for (const assay of ASSAYS) {
      if (next() < 0.3) continue;
      const repeats = options.repeats && next() < 0.35 ? 2 + Math.floor(next() * 2) : 1;
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        const row: Record<string, string> = { ID: key, SMILES: `smiles-of-${key}`, Assay: assay };
        if (!(options.emptyValues && next() < 0.25)) row.Value = (3 + next() * 6).toFixed(2);
        rows.push(row);
      }
    }
  }
  if (options.emptyKeys) {
    rows.push({ SMILES: "c1ccccc1", Assay: "COX-1", Value: "3.00" });
    rows.push({ Assay: "hERG", Value: "4.50" });
  }
  for (let index = rows.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [rows[index], rows[other]] = [rows[other], rows[index]];
  }
  return rows;
}

const SEEDS = Array.from({ length: 60 }, (_, index) => index + 1);

test("pivot followed by unpivot returns the original table, missing cells included", () => {
  for (const seed of SEEDS) {
    const table = longTable(seed);
    const pivoted = pivotTable(table, PIVOT);
    expect(pivoted.duplicateCells).toEqual([]);
    expect(pivoted.carriedConflicts).toEqual([]);
    expect(pivoted.rows.length).toBe(new Set(table.map((row) => row.ID)).size);
    // Every key has one row, and a combination the long table lacks is an empty cell.
    for (const row of pivoted.rows) {
      for (const column of pivoted.columns) {
        const original = table.find((candidate) => candidate.ID === row.ID && candidate.Assay === column);
        expect(row[column]).toBe(original?.Value);
      }
    }
    const restored = unpivotTable(pivoted.rows, { ...UNPIVOT, columns: pivoted.columns });
    expect(bag(restored.rows)).toEqual(bag(table));
  }
});

test("a row without a value leaves an empty cell, and a key with no values at all comes back as one bare row", () => {
  for (const seed of SEEDS) {
    const table = longTable(seed, { emptyValues: true });
    const pivoted = pivotTable(table, PIVOT);
    const restored = unpivotTable(pivoted.rows, { ...UNPIVOT, columns: pivoted.columns });
    const valued = table.filter((row) => row.Value !== undefined);
    const valuedKeys = new Set(valued.map((row) => row.ID));
    const bareKeys = [...new Set(table.map((row) => row.ID))].filter((key) => !valuedKeys.has(key));
    expect(bag(restored.rows)).toEqual(bag([
      ...valued,
      ...bareKeys.map((key) => ({ ID: key, SMILES: `smiles-of-${key}` })),
    ]));
    expect(restored.emptyRows.length).toBe(bareKeys.length);
  }
});

test("repeated key and category pairs are reported and survive a joined round trip", () => {
  let tablesWithRepeats = 0;
  for (const seed of SEEDS) {
    const table = longTable(seed, { repeats: true });
    const pivoted = pivotTable(table, { ...PIVOT, duplicates: "join" });
    const repeated = new Map<string, string[]>();
    for (const row of table) {
      const id = `${row.ID}\u0000${row.Assay}`;
      repeated.set(id, [...(repeated.get(id) ?? []), row.Value]);
    }
    const expected = [...repeated].filter(([, values]) => values.length > 1);
    if (expected.length) tablesWithRepeats += 1;
    expect(pivoted.duplicateCells.map((cell) => [`${cell.key}\u0000${cell.category}`, cell.values]).sort())
      .toEqual(expected.sort());
    // Joined cells split back into the rows they came from.
    const restored = unpivotTable(pivoted.rows, { ...UNPIVOT, columns: pivoted.columns, separator: "; " });
    expect(bag(restored.rows)).toEqual(bag(table));

    // "first" keeps one value per cell: the long table minus every later repeat.
    const first = pivotTable(table, { ...PIVOT, duplicates: "first" });
    const seen = new Set<string>();
    const firstOnly = table.filter((row) => {
      const id = `${row.ID}\u0000${row.Assay}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    expect(bag(unpivotTable(first.rows, { ...UNPIVOT, columns: first.columns }).rows)).toEqual(bag(firstOnly));
  }
  expect(tablesWithRepeats).toBeGreaterThan(20);
});

test("rows without a key are left alone by both directions", () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const table = longTable(seed, { emptyKeys: true });
    const pivoted = pivotTable(table, PIVOT);
    expect(pivoted.emptyKeyRows.length).toBe(2);
    for (const position of pivoted.emptyKeyRows) expect(pivoted.rows).toContain(table[position]);
    const restored = unpivotTable(pivoted.rows, { ...UNPIVOT, columns: pivoted.columns });
    expect(bag(restored.rows)).toEqual(bag(table));
  }
});

test("pivot handles duplicates, lost values, differing carried cells and name clashes explicitly", () => {
  const table = [
    { ID: "A", Assay: "IC50", Value: "5", Lab: "north" },
    { ID: "A", Assay: "IC50", Value: "7", Lab: "south" },
    { ID: "A", Assay: "Ki", Value: "n.d." },
    { ID: "A", Assay: "Ki", Value: "6" },
    { ID: "B", Value: "9" },
    { ID: "B", Assay: "Ki", Value: "4" },
  ];
  const mean = pivotTable(table, { ...PIVOT, duplicates: "mean" });
  expect(mean.columns).toEqual(["IC50", "Ki"]);
  expect(mean.groups).toEqual([
    // A mean needs numbers; a cell that holds text keeps every value instead.
    { key: "A", sources: [0, 1, 2, 3], values: { IC50: "6", Ki: "n.d.; 6" } },
    { key: "B", sources: [4, 5], values: { Ki: "4" } },
  ]);
  expect(mean.rows).toEqual([{ ID: "A", Lab: "north", IC50: "6", Ki: "n.d.; 6" }, { ID: "B", Ki: "4" }]);
  expect(mean.droppedValueRows).toEqual([4]);
  expect(mean.carriedConflicts).toEqual([{ key: "A", column: "Lab" }]);
  expect(pivotTable(table, { ...PIVOT, duplicates: "last" }).groups[0].values).toEqual({ IC50: "7", Ki: "6" });
  expect(pivotTable(table, { ...PIVOT, duplicates: "join", separator: " | " }).groups[0].values.IC50).toBe("5 | 7");

  expect(() => pivotTable([{ ID: "A", Assay: "Lab", Value: "1", Lab: "north" }], PIVOT))
    .toThrow('Assay holds the value "Lab", which is already a column.');
  expect(() => pivotTable(table, { ...PIVOT, valueColumn: "Assay" })).toThrow("three different columns");
});

test("unpivot writes rows in column order, keeps empty cells on request and refuses impossible names", () => {
  const wide = [{ ID: "A", IC50: "5", Ki: "6" }, { ID: "B", Ki: "4" }, { ID: "C" }];
  const result = unpivotTable(wide, { ...UNPIVOT, columns: ["IC50", "Ki"] });
  expect(result.entries).toEqual([
    { source: 0, category: "IC50", value: "5" },
    { source: 0, category: "Ki", value: "6" },
    { source: 1, category: "Ki", value: "4" },
    { source: 2, category: null, value: "" },
  ]);
  expect(result.emptyRows).toEqual([2]);
  expect(unpivotTable(wide, { ...UNPIVOT, columns: ["IC50", "Ki"], keepEmpty: true }).rows).toEqual([
    { ID: "A", Assay: "IC50", Value: "5" },
    { ID: "A", Assay: "Ki", Value: "6" },
    { ID: "B", Assay: "IC50" },
    { ID: "B", Assay: "Ki", Value: "4" },
    { ID: "C", Assay: "IC50" },
    { ID: "C", Assay: "Ki" },
  ]);
  expect(() => unpivotTable(wide, { ...UNPIVOT, columns: [] })).toThrow("at least one column");
  expect(() => unpivotTable(wide, { columns: ["IC50"], categoryColumn: "X", valueColumn: "X" })).toThrow("two different");
  expect(() => unpivotTable(wide, { columns: ["IC50"], categoryColumn: "IC50", valueColumn: "V" })).toThrow("into itself");
  expect(() => unpivotTable(wide, { columns: ["IC50"], categoryColumn: " ", valueColumn: "V" })).toThrow("need a name");
});

// The pandas reference is produced by fixtures/table-shaping/merge-reference.py.
const left = parseSdfDataTable(fixture("chembl-compounds.sdf"));
const right = parseDelimitedTable(fixture("chembl-activities.csv"));
const MERGE = { leftKey: "ChEMBL ID", rightKey: "molecule_chembl_id" } as const;

function expectSameCells(actual: readonly TableRow[], expectedCsv: string) {
  const expected = parseDelimitedTable(expectedCsv);
  expect(actual.length).toBe(expected.rows.length);
  actual.forEach((row, index) => {
    for (const column of expected.columns) {
      expect([index, column, row[column] ?? ""]).toEqual([index, column, expected.rows[index][column] ?? ""]);
    }
    // Nothing beyond the reference's columns either.
    expect(Object.keys(row).filter((column) => !expected.columns.includes(column))).toEqual([]);
  });
  return expected;
}

test("the SD file's data fields are the table pandas reads", () => {
  const csv = parseDelimitedTable(fixture("chembl-compounds.csv"));
  expect(left.columns).toEqual(csv.columns);
  expect(left.rows).toEqual(csv.rows);
  expect(left.rows.length).toBe(11);
});

test("merge by ChEMBL ID matches pandas cell by cell when a repeated key uses its first row", () => {
  const merged = mergeByKey(left.rows, right.rows, MERGE);
  const expected = expectSameCells(merged.rows, fixture("merge-expected-first.csv"));
  expect([...left.columns, ...merged.columns.map((column) => column.name)]).toEqual(expected.columns);
  expect(merged.columns).toEqual([
    { source: "target", name: "target" },
    { source: "pchembl_value", name: "pchembl_value" },
    { source: "Source", name: "Source_2" },
    { source: "comment", name: "comment" },
  ]);
  expect(merged.entries.map((entry) => entry.left)).toEqual(left.rows.map((_, index) => index));
});

test("merge by ChEMBL ID matches a plain pandas left join when repeated keys expand", () => {
  const merged = mergeByKey(left.rows, right.rows, { ...MERGE, duplicates: "expand" });
  expectSameCells(merged.rows, fixture("merge-expected-expand.csv"));
  // Both aspirin rows match the two CHEMBL25 rows of the file.
  expect(merged.entries.filter((entry) => entry.left === 0).map((entry) => entry.right)).toEqual([0, 1]);
  expect(merged.entries.filter((entry) => entry.left === 10).map((entry) => entry.right)).toEqual([0, 1]);
});

test("unmatched, empty and repeated keys are the ones pandas reports", () => {
  const merged = mergeByKey(left.rows, right.rows, MERGE);
  expect({
    matchedRows: merged.matchedRows,
    unmatchedLeft: merged.unmatchedLeft,
    emptyLeftKeys: merged.emptyLeftKeys,
    unmatchedRight: merged.unmatchedRight,
    emptyRightKeys: merged.emptyRightKeys,
    duplicateRight: merged.duplicateRight,
    duplicateLeft: merged.duplicateLeft,
  }).toEqual(JSON.parse(fixture("merge-expected-report.json")));
  expect(merged.unmatchedLeft.map((position) => left.rows[position]["ChEMBL ID"]))
    .toEqual(["CHEMBL112", "CHEMBL3", "CHEMBL12"]);
});

test("merge brings in only the chosen columns and never reuses a taken name", () => {
  const merged = mergeByKey([{ ID: " a " }, { ID: "b" }], [{ id: "a", Value: "1", Note: "x" }], {
    leftKey: "ID",
    rightKey: "id",
    columns: ["Value"],
    existingColumns: ["ID", "Value", "Value_2"],
  });
  expect(merged.columns).toEqual([{ source: "Value", name: "Value_2_2" }]);
  // Keys are compared without surrounding white space.
  expect(merged.entries).toEqual([
    { left: 0, right: 0, values: { Value_2_2: "1" } },
    { left: 1, right: null, values: {} },
  ]);
});

test("category counts list every value with its frequency and give up on free text", () => {
  expect(categoryCounts(left.rows.map((row) => row.Class ?? ""), 20)).toEqual([
    { value: "NSAID", count: 5 },
    { value: "Stimulant", count: 3 },
    { value: "", count: 1 },
    { value: "Analgesic", count: 1 },
    { value: "Solvent", count: 1 },
  ]);
  expect(categoryCounts(["b10", "b2", " b2 ", "b10"], 5)).toEqual([{ value: "b2", count: 2 }, { value: "b10", count: 2 }]);
  expect(categoryCounts(left.rows.map((row) => row.MW ?? ""), 5)).toBeNull();
  expect(categoryCounts([], 5)).toEqual([]);
});

test("delimited text is read with quotes, separators, a BOM and uneven rows", () => {
  expect(parseDelimitedTable('﻿id;note;note\r\n1;"a;b ""c""\nd";x\r\n2\r\n\r\n')).toEqual({
    columns: ["id", "note", "note 2"],
    rows: [{ id: "1", note: 'a;b "c"\nd', "note 2": "x" }, { id: "2" }],
  });
  expect(parseDelimitedTable("a\tb\n1\t2,3\n").rows).toEqual([{ a: "1", b: "2,3" }]);
  expect(parseDelimitedTable("a,,c\n1,2,3").columns).toEqual(["a", "Column 2", "c"]);
  expect(parseDelimitedTable("")).toEqual({ columns: [], rows: [] });
  expect(right.rows[1].comment).toBe("weak, reversible");
});

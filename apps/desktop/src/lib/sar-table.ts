// The SAR table: molecules of one R-group series laid out by the substituent
// at two positions, each cell holding the molecules that carry that pair.

/** Past this many different substituents on an axis the rarest are left out. */
export const SAR_TABLE_MAX_GROUPS = 40;

export type SarTableCell = {
  /** Grid rows of the molecules in the cell. */
  ids: number[];
  /** Mean over the molecules that have a value; null when none has. */
  mean: number | null;
  valued: number;
};

export type SarTable = {
  /** Substituent SMILES, most frequent first. */
  rowGroups: string[];
  columnGroups: string[];
  cells: Array<Array<SarTableCell | null>>;
  /** Range of the cell means, for the colour scale. */
  min: number;
  max: number;
  capped: { rows: boolean; columns: boolean };
};

function frequentGroups(counts: Map<string, number>, limit: number) {
  const groups = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([group]) => group);
  return { groups: groups.slice(0, limit), capped: groups.length > limit };
}

export function buildSarTable(
  rowGroupOf: ReadonlyMap<number, string>,
  columnGroupOf: ReadonlyMap<number, string>,
  values: ReadonlyMap<number, number>,
  members: ReadonlySet<number> | null,
  maxGroups = SAR_TABLE_MAX_GROUPS,
): SarTable {
  const placed: Array<[number, string, string]> = [];
  const rowCounts = new Map<string, number>();
  const columnCounts = new Map<string, number>();
  for (const [id, rowGroup] of rowGroupOf) {
    const columnGroup = columnGroupOf.get(id);
    if (!rowGroup || !columnGroup || (members && !members.has(id))) continue;
    placed.push([id, rowGroup, columnGroup]);
    rowCounts.set(rowGroup, (rowCounts.get(rowGroup) ?? 0) + 1);
    columnCounts.set(columnGroup, (columnCounts.get(columnGroup) ?? 0) + 1);
  }
  const rows = frequentGroups(rowCounts, maxGroups);
  const columns = frequentGroups(columnCounts, maxGroups);
  const rowIndex = new Map(rows.groups.map((group, index) => [group, index]));
  const columnIndex = new Map(columns.groups.map((group, index) => [group, index]));
  const members2d: number[][][] = rows.groups.map(() => columns.groups.map(() => []));
  for (const [id, rowGroup, columnGroup] of placed.sort((a, b) => a[0] - b[0])) {
    const row = rowIndex.get(rowGroup);
    const column = columnIndex.get(columnGroup);
    if (row !== undefined && column !== undefined) members2d[row][column].push(id);
  }
  let min = Infinity;
  let max = -Infinity;
  const cells = members2d.map((row) => row.map((ids) => {
    if (!ids.length) return null;
    const known = ids.flatMap((id) => { const value = values.get(id); return value === undefined ? [] : [value]; });
    const mean = known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
    if (mean !== null) { min = Math.min(min, mean); max = Math.max(max, mean); }
    return { ids, mean, valued: known.length };
  }));
  return { rowGroups: rows.groups, columnGroups: columns.groups, cells, min, max, capped: { rows: rows.capped, columns: columns.capped } };
}

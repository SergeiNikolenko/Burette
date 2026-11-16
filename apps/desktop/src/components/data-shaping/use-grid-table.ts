import { useEffect, useState } from "react";
import { requestGridColumns } from "../../hooks/use-app-derived-columns";
import { NAME_COLUMN, tableRows, type ReshapeColumn } from "../../lib/grid-reshape";
import { requestGridTable, type GridTable } from "../../lib/grid-table-bridge";
import type { TableRow } from "../../lib/table-shaping";

export type GridTableSnapshot = {
  /** The molecule name first, then every column of the collection's table. */
  columns: ReshapeColumn[];
  table: GridTable;
  /** One row per collection row, keyed by `columnKey`. */
  rows: TableRow[];
};

type State = { snapshot: GridTableSnapshot | null; error: string | null };

/** Reads the whole collection once, when a reshape dialog opens on it. */
export function useGridTable(documentId: string): State {
  const [state, setState] = useState<State>({ snapshot: null, error: null });
  useEffect(() => {
    let current = true;
    setState({ snapshot: null, error: null });
    void (async () => {
      try {
        const columns: ReshapeColumn[] = [NAME_COLUMN, ...await requestGridColumns(documentId)];
        const table = await requestGridTable(documentId, columns.map((column) => column.id));
        if (current) setState({ snapshot: { columns, table, rows: tableRows(table, columns) }, error: null });
      } catch (error) {
        if (current) setState({ snapshot: null, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => { current = false; };
  }, [documentId]);
  return state;
}

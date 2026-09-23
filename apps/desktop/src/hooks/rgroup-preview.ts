import { decomposeRGroupsInRuntime, fetchDerivedSourceRows, type RGroupDecomposition } from "../lib/derived-columns";

export type RGroupPreview = {
  documentId: string;
  core: string;
  sourceRows: Array<{ rowId: number; smiles: string | null; molblock: string | null }>;
  result: RGroupDecomposition;
};

// Read the entire collection, not just the visible/filtered page. The storage
// transaction compares this snapshot with the current structures before apply.
export async function prepareRGroupPreview(documentId: string, core: string): Promise<RGroupPreview> {
  const sourceRows: RGroupPreview["sourceRows"] = [];
  let afterSourceIndex = -1;
  for (;;) {
    const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, 500);
    if (batch.totalRows > 5_000 || sourceRows.length + batch.rows.length > 5_000) {
      throw new Error("R-group analysis supports up to 5,000 molecules. Open a smaller collection.");
    }
    if (!batch.rows.length) break;
    sourceRows.push(...batch.rows.map((row) => ({ rowId: row.rowId, smiles: row.smiles ?? null, molblock: row.molblock ?? null })));
    afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
  }
  if (!sourceRows.length) throw new Error("The collection has no molecules.");
  const result = await decomposeRGroupsInRuntime(core, sourceRows);
  return { documentId, core, sourceRows, result };
}

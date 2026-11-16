import { fetchDerivedSourceRows } from "../lib/derived-columns";
import { MATCHED_PAIR_LIMITS, type MatchedPairInput } from "../lib/matched-pairs/matched-pairs";
import { isTauriRuntime } from "../lib/tauri";
import { activeViewerIframeForDocument } from "../lib/viewer-bridge";
import { requestGridColumnText, requestGridRecords } from "./use-app-derived-columns";

const SOURCE_BATCH = 500;

export type MatchedPairSource = {
  /** Keyed by the grid's row index, which is also what a selection names. */
  molecules: MatchedPairInput[];
  names: Map<number, string>;
};

// The whole collection, not the page the grid holds: on the desktop from the
// collection database, in the browser from the grid, which has every row. One
// row past the limit is read so the analysis can say that it stopped there.
export async function readMatchedPairMolecules(documentId: string): Promise<MatchedPairSource> {
  const limit = MATCHED_PAIR_LIMITS.molecules + 1;
  if (!isTauriRuntime()) {
    const [records, names] = await Promise.all([requestGridRecords(documentId), requestGridColumnText(documentId, "name")]);
    return {
      molecules: records.slice(0, limit).map((record) => ({ id: record.index, smiles: record.smiles ?? null, molblock: record.molblock ?? null })),
      names,
    };
  }
  const molecules: MatchedPairInput[] = [];
  const names = new Map<number, string>();
  let afterSourceIndex = -1;
  while (molecules.length < limit) {
    const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, SOURCE_BATCH);
    if (!batch.rows.length) break;
    for (const row of batch.rows) {
      molecules.push({ id: row.sourceIndex, smiles: row.smiles ?? null, molblock: row.molblock ?? null });
      names.set(row.sourceIndex, row.name);
    }
    afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
  }
  return { molecules: molecules.slice(0, limit), names };
}

/** Replaces the grid's selection with these rows and scrolls to the first. */
export function selectGridRows(documentId: string, rowIndexes: number[]) {
  activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
    source: "burette-grid-host",
    body: { type: "chemicalSpaceSelectionChanged", documentId, sourceRecordIds: rowIndexes, filterToSelection: false, focusSourceRecordId: rowIndexes[0] },
  }, "*");
  // The inspector answers a selection with the fragment its molecules share.
  window.dispatchEvent(new CustomEvent("burette:chemical-space-selection", { detail: { documentId, sourceRecordIds: rowIndexes } }));
}

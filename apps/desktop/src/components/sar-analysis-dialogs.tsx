import { useCallback, useState } from "react";
import { MatchedPairsDialog, type MatchedPairsRequest } from "./matched-pairs-dialog";
import { SarTableDialog, type SarTableRequest } from "./sar-table-dialog";
import { requestGridColumns } from "../hooks/use-app-derived-columns";
import type { GridColumnChoice, StatusKind } from "./types";
import type { ViewerDocument } from "../types";

const RGROUP_COLUMN = /^(descriptor|prop):RGroup_(Series|R[1-9][0-9]*)$/;

// The decomposition's columns, whether it ran in this session or came with
// the file; a column computed in this session wins over a saved one.
function rgroupColumns(columns: GridColumnChoice[]) {
  const byLabel = new Map<string, GridColumnChoice>();
  for (const column of columns) {
    const match = RGROUP_COLUMN.exec(column.id);
    if (match && (match[1] === "descriptor" || !byLabel.has(match[2]))) byLabel.set(match[2], column);
  }
  const series = byLabel.get("Series") ?? null;
  byLabel.delete("Series");
  const positions = [...byLabel].sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1))).map(([, column]) => column);
  return { positions, seriesColumnId: series?.id ?? null };
}

/** Matched pairs and the SAR table: the two Analyze dialogs that read a
 * collection's molecules and columns without adding anything to it. */
export function useSarAnalysisDialogs({ documents, pushStatus }: {
  documents: ViewerDocument[];
  pushStatus: (message: string, kind?: StatusKind) => void;
}) {
  const [matchedPairsRequest, setMatchedPairsRequest] = useState<MatchedPairsRequest | null>(null);
  const [sarTableRequest, setSarTableRequest] = useState<SarTableRequest | null>(null);
  const openMatchedPairs = useCallback(async (documentId: string) => {
    const target = documents.find((document) => document.id === documentId);
    if (!target) return;
    try {
      const columns = (await requestGridColumns(documentId)).filter((column) => column.type === "number");
      if (!columns.length) pushStatus(`${target.title} has no numeric column to compare.`, "error");
      else setMatchedPairsRequest({ documentId, documentTitle: target.title, columns });
    } catch (error) {
      pushStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }, [documents, pushStatus]);
  const openSarTable = useCallback(async (documentId: string) => {
    const target = documents.find((document) => document.id === documentId);
    if (!target) return;
    try {
      const catalog = await requestGridColumns(documentId);
      const columns = catalog.filter((column) => column.type === "number");
      const rgroups = rgroupColumns(catalog);
      if (rgroups.positions.length < 2) pushStatus("Decompose R-groups first: the SAR table needs two R positions.", "error");
      else if (!columns.length) pushStatus(`${target.title} has no numeric column to colour by.`, "error");
      else setSarTableRequest({ documentId, documentTitle: target.title, columns, ...rgroups });
    } catch (error) {
      pushStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }, [documents, pushStatus]);
  const sarAnalysisDialogs = <>
    <MatchedPairsDialog request={matchedPairsRequest} onDismiss={() => setMatchedPairsRequest(null)} />
    <SarTableDialog request={sarTableRequest} onDismiss={() => setSarTableRequest(null)} />
  </>;
  return { openMatchedPairs, openSarTable, sarAnalysisDialogs };
}

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Spinner } from "./ui/spinner";

import { correlationMatrix, type CorrelationMatrixResult } from "../lib/correlation-matrix.mjs";
import type { GridColumnChoice } from "./types";

export type CorrelationMatrixRequest = {
  documentId: string;
  documentTitle: string;
  // From the grid's catalog: the filter model describes one page of a paged
  // collection, so on the desktop it offered no columns to correlate.
  columns: GridColumnChoice[];
};

const COLUMN_VALUES_TIMEOUT_MS = 20_000;

// The grid already answers with a column's numeric values for chemical space;
// the matrix borrows that channel rather than shipping the table to the host.
function requestColumnValues(documentId: string, columnId: string): Promise<Array<[number, number]>> {
  return new Promise((resolve, reject) => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      `.viewer-iframe[data-document-id="${CSS.escape(documentId)}"][data-renderer="grid2d"]`,
    );
    if (!iframe?.contentWindow) {
      reject(new Error("The collection is not open."));
      return;
    }
    const requestId = `correlation-${crypto.randomUUID()}`;
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`The grid did not return values for ${columnId}.`));
    }, COLUMN_VALUES_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; body?: Record<string, unknown> } | null;
      if (data?.source !== "burette-grid"
        || data.body?.type !== "chemicalSpaceColumnValues"
        || data.body?.requestId !== requestId) return;
      cleanup();
      const values = Array.isArray(data.body.values) ? data.body.values : [];
      resolve(values as Array<[number, number]>);
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };
    window.addEventListener("message", onMessage);
    iframe.contentWindow.postMessage({
      source: "burette-grid-host",
      body: { type: "chemicalSpaceRequestColumnValues", requestId, documentId, columnId },
    }, "*");
  });
}

function cellStyle(value: number | null) {
  if (value === null) return undefined;
  // Strength by opacity, direction by the accent versus a neutral ink, so the
  // matrix reads without relying on a second hue.
  const strength = Math.min(1, Math.abs(value));
  return {
    background: value >= 0
      ? `color-mix(in srgb, var(--accent) ${(strength * 55).toFixed(0)}%, transparent)`
      : `color-mix(in srgb, var(--text-primary) ${(strength * 32).toFixed(0)}%, transparent)`,
  };
}

export function CorrelationMatrixDialog({
  request,
  onDismiss,
}: {
  request: CorrelationMatrixRequest | null;
  onDismiss: () => void;
}) {
  const [result, setResult] = useState<CorrelationMatrixResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setResult(null);
    setLoading(false);
    if (!request) {
      setError(null);
      return undefined;
    }
    const numeric = (request?.columns ?? []).filter((column) => column.type === "number");
    if (numeric.length < 2) {
      setError("This collection has fewer than two numeric columns to correlate.");
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const columns = [];
        for (const column of numeric) {
          const values = await requestColumnValues(request.documentId, column.id);
          if (cancelled) return;
          columns.push({ id: column.id, label: column.label, values });
        }
        if (!cancelled) setResult(correlationMatrix(columns));
      } catch (caught) {
        if (!cancelled) {
          console.error("[Correlation matrix]", caught);
          setError("Could not read this collection. Reopen the matrix to try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [request]);

  return (
    <Dialog open={request !== null} onOpenChange={open => { if (!open) onDismiss(); }}>
      <DialogContent variant="form" size="xwide" className="min-w-0 overscroll-contain">
        <DialogHeader>
          <DialogTitle>Correlation matrix</DialogTitle>
          <DialogDescription className="sr-only">Pearson correlations for {request?.documentTitle}.</DialogDescription>
        </DialogHeader>
        {error && <p className="py-5 text-sm text-(--color-text-secondary)" role="alert">{error}</p>}
        {loading && <div className="flex items-center justify-center gap-2 py-5 text-sm text-(--color-text-secondary)" role="status"><Spinner className="size-4" aria-hidden />Reading columns…</div>}
        {result && !error ? (
          <div className="correlation-matrix-scroll">
            <table className="correlation-matrix-table" aria-label="Pearson correlation coefficients">
              <thead>
                <tr>
                  <th scope="col" />
                  {result.labels.map((label, index) => (
                    <th key={result.ids[index]} scope="col" title={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.labels.map((rowLabel, row) => (
                  <tr key={result.ids[row]}>
                    <th scope="row" title={rowLabel}>{rowLabel}</th>
                    {result.matrix[row].map((value, column) => (
                      <td
                        key={result.ids[column]}
                        style={cellStyle(value)}
                        title={value === null
                          ? `${rowLabel} vs ${result.labels[column]}: correlation unavailable`
                          : `${rowLabel} vs ${result.labels[column]}: r = ${value.toFixed(3)} over ${result.counts[row][column].toLocaleString()} rows`}
                      >
                        {value === null ? "" : value.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {result && !error && <p className="text-xs text-(--color-text-secondary)">Each pair uses rows with values in both columns.</p>}
      </DialogContent>
    </Dialog>
  );
}

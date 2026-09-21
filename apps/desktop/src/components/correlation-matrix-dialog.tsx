import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";

import { correlationMatrix, type CorrelationMatrixResult } from "../lib/correlation-matrix.mjs";
import type { GridColumnChoice } from "./types";
import { useAppShellPortalContainer } from "./ui/portal-container";
import { CloseIcon } from "./close-icon";

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
  const portalContainer = useAppShellPortalContainer();
  const [result, setResult] = useState<CorrelationMatrixResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!request) {
      setResult(null);
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
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [request]);

  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog correlation-matrix-dialog" aria-describedby="correlation-matrix-body">
          <div className="radix-dialog-header">
            <Dialog.Title>Correlation Matrix</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Close correlation matrix">
                <CloseIcon size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div id="correlation-matrix-body" className="radix-dialog-body">
            <p className="correlation-matrix-target">
              Pearson correlation between the numeric columns of <strong>{request?.documentTitle}</strong>.
              Each pair uses the rows where both columns carry a value.
            </p>
            {error ? <div className="correlation-matrix-message">{error}</div> : null}
            {loading && !result ? <div className="correlation-matrix-message">Reading columns…</div> : null}
            {result && !error ? (
              <div className="correlation-matrix-scroll">
                <table className="correlation-matrix-table">
                  <thead>
                    <tr>
                      <th scope="col" />
                      {result.labels.map((label) => (
                        <th key={label} scope="col" title={label}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.labels.map((rowLabel, row) => (
                      <tr key={rowLabel}>
                        <th scope="row" title={rowLabel}>{rowLabel}</th>
                        {result.matrix[row].map((value, column) => (
                          <td
                            key={`${rowLabel}:${result.labels[column]}`}
                            style={cellStyle(value)}
                            title={value === null
                              ? `${rowLabel} vs ${result.labels[column]}: too few shared rows`
                              : `${rowLabel} vs ${result.labels[column]}: r = ${value.toFixed(3)} over ${result.counts[row][column].toLocaleString()} rows`}
                          >
                            {value === null ? "–" : value.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

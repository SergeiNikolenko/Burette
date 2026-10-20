import { useState } from "react";
import { CorrelationMatrixDialog } from "@/components/correlation-matrix-dialog";
import { Button } from "@/components/ui/button";
import type { GridColumnChoice } from "@/components/types";

const columns: GridColumnChoice[] = ["Mass", "Activity", "Inverse", "Constant"].map(id => ({ id, label: id, type: "number", kind: "property" }));
const request = { documentId: "correlation-example", documentTitle: "Series", columns };
// A local grid-channel fixture: the real dialog requests values and computes Pearson r.
const source = `<script>
addEventListener('message', event => {
  const { source, body } = event.data || {};
  if (source !== 'burette-grid-host' || body?.type !== 'chemicalSpaceRequestColumnValues') return;
  const values = Array.from({ length: 5 }, (_, i) => [i, { Mass: 100 + i * 10, Activity: i * 2, Inverse: 5 - i, Constant: 1 }[body.columnId]]);
  parent.postMessage({ source: 'burette-grid', body: { type: 'chemicalSpaceColumnValues', requestId: body.requestId, values } }, '*');
});
</script>`;

export function CorrelationExample() {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  return <section aria-label="Correlation example">
    <iframe hidden title="Correlation sample values" className="viewer-iframe" data-document-id={request.documentId} data-renderer="grid2d"
      srcDoc={source} onLoad={() => setReady(true)} />
    <Button variant="secondary" disabled={!ready} onClick={() => setOpen(true)}>Correlation matrix</Button>
    <CorrelationMatrixDialog request={open ? request : null} onDismiss={() => setOpen(false)} />
  </section>;
}

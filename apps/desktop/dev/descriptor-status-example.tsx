import { GridDescriptorStatus } from "@/components/grid-descriptor-status";
import { GRID_DESCRIPTOR_JOB_EVENT } from "@/hooks/use-app-descriptors";
import type { GridDescriptorJobStatus } from "@/lib/descriptors";
import { Button } from "@/components/ui/button";

// A dedicated preview document: events only, no calculation or file operations.
const documentId = "descriptor-status-example";
function show(status: GridDescriptorJobStatus["status"], totalRows = 20) {
  const detail: GridDescriptorJobStatus = { documentId, status, running: status === "running", totalRows, processedRows: 8, calculatedRows: 8, failedRows: 0, message: "", startedAtMs: Date.now() };
  window.dispatchEvent(new CustomEvent(GRID_DESCRIPTOR_JOB_EVENT, { detail }));
}
export function DescriptorStatusExample() {
  return <section className="w-full max-w-[600px] shrink-0" aria-label="Molecular property progress">
    <div className="mb-4 flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => show("running")}>Property progress</Button>
      <Button variant="secondary" onClick={() => show("running", 0)}>Unknown total</Button>
      <Button variant="secondary" onClick={() => show("cancelled")}>Cancelled properties</Button>
      <Button variant="secondary" onClick={() => show("failed")}>Failed properties</Button>
    </div>
    <div className="max-w-[340px] bg-(--color-surface)"><GridDescriptorStatus documentId={documentId} /></div>
  </section>;
}

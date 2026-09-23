import type { DerivedComputeResult, DerivedComputeRow } from "./derived-column-compute.mjs";
import type { ScaffoldRequest, ScaffoldResponse } from "../workers/scaffold.worker";

// One worker per analysis, one bounded batch in flight; releasing it also
// releases OCL's heap. Scaffold analysis does not need RDKit or predictor tables.
export class ScaffoldWorker {
  private readonly worker = new Worker(new URL("../workers/scaffold.worker.ts", import.meta.url), {
    type: "module", name: "burette-scaffolds",
  });
  private nextId = 0;
  private pending: ((error: Error) => void) | null = null;
  private disposed = false;

  compute(rows: DerivedComputeRow[]): Promise<DerivedComputeResult[]> {
    if (this.disposed || this.pending) return Promise.reject(new Error("Scaffold worker is unavailable"));
    const inputs = rows.map(({ smiles, molblock }) => ({ smiles, molblock }));
    if (inputs.length > 200 || inputs.reduce((size, row) => size + (row.smiles?.length ?? 0) + (row.molblock?.length ?? 0), 0) > 4 * 1024 * 1024) {
      return Promise.reject(new Error("Scaffold batch exceeds the molecular input limit"));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.pending = null;
        this.worker.onmessage = null;
        this.worker.onerror = null;
      };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const timeout = setTimeout(() => {
        fail(new Error("Scaffold calculation timed out"));
        this.dispose();
      }, 30_000);
      this.pending = fail;
      this.worker.onerror = (event) => {
        fail(new Error(event.message || "Scaffold worker failed"));
        this.dispose();
      };
      this.worker.onmessage = (event: MessageEvent<ScaffoldResponse>) => {
        if (event.data.id !== id) return;
        cleanup();
        if (event.data.error) reject(new Error(event.data.error));
        else if (event.data.results?.length === rows.length) resolve(event.data.results);
        else reject(new Error("Scaffold worker returned an incomplete batch"));
      };
      try {
        this.worker.postMessage({ id, rows: inputs } satisfies ScaffoldRequest);
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  dispose() {
    this.disposed = true;
    this.pending?.(new Error("Scaffold calculation stopped"));
    this.worker.terminate();
  }
}

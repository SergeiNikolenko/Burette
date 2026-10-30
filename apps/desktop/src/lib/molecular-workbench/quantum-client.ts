import { shellSize } from "./gaussian-angular";
import type { QuantumField, QuantumGridOptions } from "./gaussian";
import type { ScalarGrid, ScientificDocument } from "./scientific-types";

export type QuantumWorkerRequest = { type: "evaluate-field"; document: ScientificDocument; field: QuantumField; options: QuantumGridOptions };
export type QuantumWorkerResponse = { type: "field-result"; grid: ScalarGrid } | { type: "field-error"; error: string };

/** One bounded job per worker. Aborting terminates its numerical loop immediately. */
export function computeQuantumGrid(document: ScientificDocument, field: QuantumField, options: QuantumGridOptions = {}, signal?: AbortSignal): Promise<ScalarGrid> {
  if (signal?.aborted) return Promise.reject(new DOMException("Quantum field calculation cancelled.", "AbortError"));
  // Check clone cost before allocating a worker; the evaluator separately bounds grid work.
  const basis = document.basis;
  if (!basis?.length || basis.length > 2_000 || document.atoms.length > 10_000 || document.orbitals.length > 2_000_000
    || basis.reduce((sum, shell) => sum + shellSize(shell), 0) > 2_000
    || basis.reduce((sum, shell) => sum + shell.exponents.length + shell.coefficients.length, 0) > 500_000
    || document.orbitals.reduce((sum, orbital) => sum + orbital.coefficients.length, 0) > 2_000_000) {
    return Promise.reject(new Error("Quantum input exceeds browser limits or has no Gaussian basis."));
  }
  // Exclude trajectory, normal modes and prior grids from the worker's structured clone.
  const input: ScientificDocument = { format: document.format, atoms: document.atoms, basis: document.basis,
    orbitals: field.kind === "orbital" ? document.orbitals.filter((_, index) => index === field.orbitalIndex) : document.orbitals,
    frames: [], modes: [] };
  const request: QuantumWorkerRequest = { type: "evaluate-field", document: input,
    field: field.kind === "orbital" ? { kind: "orbital", orbitalIndex: 0 } : field, options };
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./quantum-worker.ts", import.meta.url), { type: "module", name: "burette-quantum-field" });
    const finish = (error?: Error, grid?: ScalarGrid) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      if (error) reject(error); else if (grid) resolve(grid);
    };
    const onAbort = () => finish(new DOMException("Quantum field calculation cancelled.", "AbortError"));
    const timeout = setTimeout(() => finish(new Error("Quantum field calculation exceeded 60 seconds.")), 60_000);
    worker.addEventListener("message", (event: MessageEvent<QuantumWorkerResponse>) => {
      if (event.data.type === "field-result") finish(undefined, event.data.grid);
      else finish(new Error(event.data.type === "field-error" ? event.data.error : "Invalid quantum worker response."));
    }, { once: true });
    worker.addEventListener("error", (event: ErrorEvent) => finish(new Error(event.message || "Quantum field worker failed.")), { once: true });
    worker.addEventListener("messageerror", () => finish(new Error("Quantum field worker returned unreadable data.")), { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    try { worker.postMessage(request); } catch (error) { finish(error instanceof Error ? error : new Error("Cannot start quantum field calculation.")); }
  });
}

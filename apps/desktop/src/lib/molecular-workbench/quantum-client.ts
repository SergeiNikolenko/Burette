import { shellSize } from "./gaussian-angular";
import type { QuantumField, QuantumGridOptions } from "./gaussian";
import type { CartesianHessian } from "./hessian";
import type { ScalarGrid, ScientificDocument, VibrationalMode } from "./scientific-types";
import type { MolecularAtom } from "./types";

export type QuantumWorkerRequest = { type: "evaluate-field"; document: ScientificDocument; field: QuantumField; options: QuantumGridOptions }
  | { type: "harmonic-modes"; atoms: MolecularAtom[]; hessian: CartesianHessian };
export type QuantumWorkerResponse = { type: "field-result"; grid: ScalarGrid } | { type: "modes-result"; modes: VibrationalMode[] } | { type: "field-error"; error: string };

/** The bounded calculation input shared by workers and immutable agent revisions. */
export function quantumCalculationInput(document: ScientificDocument): ScientificDocument {
  // Check clone cost before allocating a worker; the evaluator separately bounds grid work.
  const basis = document.basis;
  if (!basis?.length || basis.length > 2_000 || document.atoms.length > 10_000 || document.orbitals.length > 2_000_000
    || basis.reduce((sum, shell) => sum + shellSize(shell), 0) > 2_000
    || basis.reduce((sum, shell) => sum + shell.exponents.length + shell.coefficients.length, 0) > 500_000
    || document.orbitals.reduce((sum, orbital) => sum + orbital.coefficients.length, 0) > 2_000_000) {
    throw new Error("Quantum input exceeds browser limits or has no Gaussian basis.");
  }
  return { format: document.format,
    atoms: document.atoms.map(({ element, x, y, z }) => ({ element, x, y, z })),
    basis: basis.map(({ atomIndex, kind, spherical, cartesianOrder, exponents, coefficients }) =>
      ({ atomIndex, kind, spherical, cartesianOrder, exponents: Array.from(exponents), coefficients: Array.from(coefficients) })),
    orbitals: document.orbitals.map(({ index, energyHartree, occupancy, spin, symmetry, coefficients }) =>
      ({ index, energyHartree, occupancy, spin, symmetry, coefficients: Array.from(coefficients) })),
    frames: [], modes: [] };
}

/** One bounded job per worker. Aborting terminates its numerical loop immediately. */
export function computeQuantumGrid(document: ScientificDocument, field: QuantumField, options: QuantumGridOptions = {}, signal?: AbortSignal): Promise<ScalarGrid> {
  if (signal?.aborted) return Promise.reject(new DOMException("Quantum field calculation cancelled.", "AbortError"));
  let input: ScientificDocument;
  try { input = quantumCalculationInput(document); } catch (error) { return Promise.reject(error); }
  if (field.kind === "orbital") input.orbitals = input.orbitals.filter((_, index) => index === field.orbitalIndex);
  return runQuantumWorker({ type: "evaluate-field", document: input, field: field.kind === "orbital" ? { kind: "orbital", orbitalIndex: 0 } : field, options },
    "field-result", signal).then(response => response.grid);
}

/** Harmonic normal modes of one geometry's Hessian, diagonalized off the main thread. */
export function computeHarmonicModes(atoms: readonly MolecularAtom[], hessian: CartesianHessian, signal?: AbortSignal): Promise<VibrationalMode[]> {
  return runQuantumWorker({ type: "harmonic-modes", atoms: atoms.map(({ element, x, y, z }) => ({ element, x, y, z })), hessian }, "modes-result", signal)
    .then(response => response.modes);
}

function runQuantumWorker<T extends Exclude<QuantumWorkerResponse["type"], "field-error">>(request: QuantumWorkerRequest, expected: T, signal?: AbortSignal) {
  type Result = Extract<QuantumWorkerResponse, { type: T }>;
  if (signal?.aborted) return Promise.reject(new DOMException("Quantum field calculation cancelled.", "AbortError"));
  return new Promise<Result>((resolve, reject) => {
    const worker = new Worker(new URL("./quantum-worker.ts", import.meta.url), { type: "module", name: "burette-quantum-field" });
    const finish = (error?: Error, result?: Result) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      if (error) reject(error); else if (result) resolve(result);
    };
    const onAbort = () => finish(new DOMException("Quantum field calculation cancelled.", "AbortError"));
    const timeout = setTimeout(() => finish(new Error("Quantum field calculation exceeded 60 seconds.")), 60_000);
    worker.addEventListener("message", (event: MessageEvent<QuantumWorkerResponse>) => {
      if (event.data.type === expected) finish(undefined, event.data as Result);
      else finish(new Error(event.data.type === "field-error" ? event.data.error : "Invalid quantum worker response."));
    }, { once: true });
    worker.addEventListener("error", (event: ErrorEvent) => finish(new Error(event.message || "Quantum field worker failed.")), { once: true });
    worker.addEventListener("messageerror", () => finish(new Error("Quantum field worker returned unreadable data.")), { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    try { worker.postMessage(request); } catch (error) { finish(error instanceof Error ? error : new Error("Cannot start quantum field calculation.")); }
  });
}

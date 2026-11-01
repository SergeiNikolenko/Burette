import type { CrystalRequest, CrystalResults } from "../molecular-workbench/crystal-symmetry-io";
import type { ViewerDocument } from "../../types";
import { documentExtension } from "./source";
import { workbenchSupportsDocument } from "./structure";

export type { CrystalRequest, CrystalResults, CrystalSourceFormat } from "../molecular-workbench/crystal-symmetry-io";

const CRYSTAL_TIMEOUT_MS = 60_000;

/** Documents whose own text holds an explicit cell the symmetry finder can read. */
export function crystalSourceFormat(document: ViewerDocument | null) {
  if (!workbenchSupportsDocument(document)) return null;
  const extension = documentExtension(document);
  return extension === "cif" || extension === "mmcif" || extension === "mcif" ? "cif" as const : extension === "xyz" ? "xyz" as const : null;
}

/**
 * One isolated worker per job: the WebAssembly symmetry finder never runs on the main
 * thread, and aborting or the time limit terminates the worker mid-calculation.
 */
export function runCrystalTask<T extends CrystalRequest>(request: T, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CrystalResults[T["action"]]> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException("Calculation cancelled.", "AbortError")); return; }
    const worker = new Worker(new URL("./crystal-worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException("Calculation cancelled.", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("The symmetry calculation exceeded the browser time limit.")); }, options.timeoutMs ?? CRYSTAL_TIMEOUT_MS);
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      cleanup();
      if (event.data?.ok) resolve(event.data.result);
      else reject(new Error(typeof event.data?.error === "string" ? event.data.error.slice(0, 500) : "The symmetry calculation failed."));
    };
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || "The symmetry worker failed.")); };
    try { worker.postMessage(request); } catch (error) { cleanup(); reject(error); }
  });
}

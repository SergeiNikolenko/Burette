import type { PowderPattern, PowderXrdRequest } from "../molecular-workbench/xrd/powder-xrd";

const XRD_TIMEOUT_MS = 60_000;

/**
 * One isolated worker per pattern: structure factors never run on the main
 * thread, and aborting or the time limit terminates the worker mid-sum.
 */
export function runPowderXrdTask(request: PowderXrdRequest, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<PowderPattern> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException("Calculation cancelled.", "AbortError")); return; }
    const worker = new Worker(new URL("./xrd-worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException("Calculation cancelled.", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("The diffraction calculation exceeded the browser time limit.")); }, options.timeoutMs ?? XRD_TIMEOUT_MS);
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      cleanup();
      if (event.data?.ok) resolve(event.data.result);
      else reject(new Error(typeof event.data?.error === "string" ? event.data.error.slice(0, 500) : "The diffraction calculation failed."));
    };
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || "The diffraction worker failed.")); };
    try { worker.postMessage(request); } catch (error) { cleanup(); reject(error); }
  });
}

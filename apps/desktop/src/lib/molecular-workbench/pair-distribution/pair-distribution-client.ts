import type { PairDistribution, PairDistributionRequest } from "./pair-distribution";

/** A separate worker keeps periodic image enumeration off the UI thread; abort terminates it immediately. */
export function runPairDistributionTask(request: PairDistributionRequest, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<PairDistribution> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException("Calculation cancelled.", "AbortError")); return; }
    const worker = new Worker(new URL("./pair-distribution-worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException("Calculation cancelled.", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("The pair distribution calculation exceeded the time limit. Lower r max and try again.")); }, options.timeoutMs ?? 60_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      cleanup();
      if (event.data?.ok) resolve(event.data.result);
      else reject(new Error(typeof event.data?.error === "string" ? event.data.error.slice(0, 500) : "Could not calculate the pair distribution."));
    };
    worker.onerror = () => { cleanup(); reject(new Error("Could not calculate the pair distribution. Try again.")); };
    try { worker.postMessage(request); } catch (error) { cleanup(); reject(error); }
  });
}

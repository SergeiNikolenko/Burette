import type { NiggliInput, NiggliResult } from "./niggli";
import type { PointGroupInput, PointGroupResult, SymmetrizeResult } from "./point-group";

export type SymmetryRequest =
  | { action: "detect-point-group"; input: PointGroupInput }
  | { action: "symmetrize"; input: PointGroupInput }
  | { action: "niggli-reduce"; input: NiggliInput };

export type SymmetryResults = {
  "detect-point-group": PointGroupResult;
  symmetrize: SymmetrizeResult;
  "niggli-reduce": NiggliResult;
};

export type SymmetryTaskOptions = { signal?: AbortSignal; timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 30_000;

/** Each job runs in its own worker. Cancellation and timeouts terminate the
 * worker, which stops synchronous WebAssembly work immediately. */
export function runSymmetryTask<T extends SymmetryRequest>(request: T, options: SymmetryTaskOptions = {}): Promise<SymmetryResults[T["action"]]> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException("Symmetry calculation cancelled.", "AbortError")); return; }
    const worker = new Worker(new URL("./symmetry-worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException("Symmetry calculation cancelled.", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Symmetry calculation exceeded the browser time limit.")); }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => {
      cleanup();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    worker.onerror = event => { cleanup(); reject(new Error(event.message || "Symmetry worker failed.")); };
    try { worker.postMessage(request); } catch (error) { cleanup(); reject(error); }
  });
}

/** Keeps only the newest request alive: starting a job cancels the previous
 * one, so a superseded result can never be applied to a newer structure. */
export function createLatestSymmetryRunner() {
  let current: AbortController | undefined;
  return {
    run<T extends SymmetryRequest>(request: T, options: Omit<SymmetryTaskOptions, "signal"> = {}) {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      return runSymmetryTask(request, { ...options, signal: controller.signal }).finally(() => {
        if (current === controller) current = undefined;
      });
    },
    cancel() {
      current?.abort();
      current = undefined;
    },
  };
}

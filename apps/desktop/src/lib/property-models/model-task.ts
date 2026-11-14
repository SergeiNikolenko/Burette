import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";
import type { PropertyModelRequest, PropertyModelResult } from "./build";

// A forest on the largest allowed table is minutes of work; the dialog shows
// progress and can stop it, so the limit only guards against a stuck worker.
const MODEL_TIMEOUT_MS = 15 * 60_000;

/** One private worker per build: stopping the build terminates it mid-tree. `onProgress` receives the done fraction. */
export function runPropertyModel(request: PropertyModelRequest, task: WorkerTaskOptions<number> = {}): Promise<PropertyModelResult> {
  return runWorkerTask(() => new Worker(new URL("./model-worker.ts", import.meta.url), { type: "module", name: "burette-property-model" }),
    request, { timeoutMs: MODEL_TIMEOUT_MS, ...task });
}

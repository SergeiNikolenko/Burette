import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";
import type { MatchedPairInput, MatchedPairsResult } from "./matched-pairs";
import type { MatchedPairsProgress } from "./matched-pairs-worker";

/** Fragments and pairs a collection off the main thread; aborting the signal
 * terminates the worker mid-fragmentation. */
export function runMatchedPairs(molecules: MatchedPairInput[], options: WorkerTaskOptions<MatchedPairsProgress> = {}): Promise<MatchedPairsResult> {
  return runWorkerTask(
    () => new Worker(new URL("./matched-pairs-worker.ts", import.meta.url), { type: "module", name: "burette-matched-pairs" }),
    { molecules },
    { timeoutMs: 300_000, ...options },
  );
}

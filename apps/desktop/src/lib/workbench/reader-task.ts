import type { ScientificDocument } from "../molecular-workbench/scientific-types";
import type { readCifCrystal } from "../molecular-workbench/cif-crystal";
import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";

export type ReaderRequest = { action: "parse"; name: string; text: string } | { action: "cif"; text: string };
type ReaderResults = { parse: ScientificDocument; cif: Awaited<ReturnType<typeof readCifCrystal>> };

/** Reading scientific coordinates never loads the general builders or assembly worker. */
export function runReaderTask<T extends ReaderRequest>(request: T, options: WorkerTaskOptions = {}): Promise<ReaderResults[T["action"]]> {
  return runWorkerTask(() => new Worker(new URL("./reader-worker.ts", import.meta.url), { type: "module" }), request, options);
}
